(function initRitoSpeechEngine(globalScope) {
  const root = globalScope || globalThis;
  const Rito = (root.Rito = root.Rito || {});

  const TARGET_SAMPLE_RATE = 16000;
  const PRE_ROLL_MS = 300;
  const MAX_INFLIGHT_REQUESTS = 2;
  const LEVEL_EMIT_INTERVAL_MS = 100;

  // Speech-to-text via Groq Whisper. Audio is captured locally, split into
  // utterances with an energy-based VAD, and transcribed by the service worker.
  class SpeechEngine extends EventTarget {
    constructor(options) {
      super();
      const opts = options || {};
      this.logger = opts.logger || Rito.createLogger("speech");
      this.settings = Object.assign(
        {},
        Rito.DEFAULT_SETTINGS,
        opts.settings || {},
      );
      this.mode = Rito.COMMAND_MODES.COMMANDS;
      this.shouldRun = false;
      this.isListening = false;
      this.paused = false;
      this.armedUntil = 0;
      this.mediaStream = null;
      this.audioContext = null;
      this.analyser = null;
      this.processor = null;
      this.outputGain = null;
      this.resumeOnGesture = null;
      this.inflightRequests = 0;
      this.cooldownUntil = 0;
      this.lastLevelEmitAt = 0;
      this._resetVadState();
      this.noiseFloor = 0.005;
    }

    updateSettings(nextSettings) {
      this.settings = Object.assign({}, this.settings, nextSettings || {});
    }

    setMode(mode) {
      this.mode = mode;
    }

    start() {
      if (this.shouldRun) {
        return;
      }
      this.shouldRun = true;
      this.paused = false;
      this._openMicrophone();
    }

    stop() {
      this.shouldRun = false;
      this.paused = false;
      this.armedUntil = 0;
      this._resetVadState();
      this._removeGestureResume();

      if (this.processor) {
        this.processor.onaudioprocess = null;
        this.processor.disconnect();
        this.processor = null;
      }

      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach((track) => {
          track.stop();
        });
        this.mediaStream = null;
      }

      if (this.audioContext) {
        this.audioContext.close().catch(() => undefined);
        this.audioContext = null;
        this.analyser = null;
        this.outputGain = null;
      }

      if (this.isListening) {
        this.isListening = false;
        this._emit("listening-state", { listening: false });
      }
    }

    pause() {
      // Temporary pause without releasing the microphone.
      if (!this.isListening || this.paused) {
        return;
      }
      this.paused = true;
      this._resetVadState();
      if (this.audioContext) {
        this.audioContext.suspend().catch(() => undefined);
      }
      this.logger.debug("Speech capture paused");
    }

    resume() {
      if (!this.shouldRun || !this.paused) {
        return;
      }
      this.paused = false;
      if (this.audioContext) {
        this.audioContext.resume().catch(() => undefined);
      }
      this.logger.debug("Speech capture resumed");
    }

    async _openMicrophone() {
      const AudioContext = root.AudioContext || root.webkitAudioContext;
      const mediaDevices = root.navigator && root.navigator.mediaDevices;
      if (!AudioContext || !mediaDevices || !mediaDevices.getUserMedia) {
        this._fail("unsupported", "Microphone capture is not available here.");
        return;
      }

      let stream;
      try {
        stream = await mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
      } catch (error) {
        const denied =
          error &&
          (error.name === "NotAllowedError" || error.name === "SecurityError");
        this._fail(
          denied ? "not-allowed" : "audio-capture",
          denied
            ? "Microphone permission denied - enable microphone access"
            : "Microphone not working - check your audio settings",
        );
        return;
      }

      if (!this.shouldRun) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      try {
        this.mediaStream = stream;
        this.audioContext = new AudioContext();
        const source = this.audioContext.createMediaStreamSource(stream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 512;

        // ScriptProcessor avoids audioWorklet.addModule, which page CSPs can block.
        this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
        this.processor.onaudioprocess = (event) => {
          this._handleAudioFrame(event.inputBuffer.getChannelData(0));
        };

        // The processor only runs while connected to the destination; keep it silent.
        this.outputGain = this.audioContext.createGain();
        this.outputGain.gain.value = 0;

        source.connect(this.analyser);
        source.connect(this.processor);
        this.processor.connect(this.outputGain);
        this.outputGain.connect(this.audioContext.destination);
      } catch (error) {
        this.logger.warn("Failed to build audio pipeline", error);
        this._fail("audio-capture", "Could not start audio processing.");
        return;
      }

      if (this.audioContext.state === "suspended") {
        await this.audioContext.resume().catch(() => undefined);
        if (this.audioContext && this.audioContext.state === "suspended") {
          this._installGestureResume();
        }
      }

      this.isListening = true;
      this._emit("listening-state", { listening: true });
      this.logger.debug("Speech capture started", {
        sampleRate: this.audioContext.sampleRate,
      });
    }

    // Autoplay policy can leave the context suspended until the user interacts.
    _installGestureResume() {
      this._removeGestureResume();
      this.resumeOnGesture = () => {
        if (this.audioContext && !this.paused) {
          this.audioContext.resume().catch(() => undefined);
        }
        this._removeGestureResume();
      };
      root.addEventListener("pointerdown", this.resumeOnGesture, true);
      root.addEventListener("keydown", this.resumeOnGesture, true);
    }

    _removeGestureResume() {
      if (!this.resumeOnGesture) {
        return;
      }
      root.removeEventListener("pointerdown", this.resumeOnGesture, true);
      root.removeEventListener("keydown", this.resumeOnGesture, true);
      this.resumeOnGesture = null;
    }

    _fail(code, message) {
      this.logger.error(`Speech capture error: ${message}`);
      this._emit("error", { code, message });
      this.stop();
    }

    _resetVadState() {
      this.speaking = false;
      this.preRoll = [];
      this.preRollMs = 0;
      this.utterance = [];
      this.utteranceMs = 0;
      this.speechMs = 0;
      this.silenceMs = 0;
    }

    _speechThreshold() {
      // Higher sensitivity setting = stricter (matches the options page copy).
      const sensitivity = Math.max(
        0,
        Math.min(1, Number(this.settings.microphoneSensitivity) || 0),
      );
      const multiplier = 1.8 + sensitivity * 3;
      const absoluteMin = 0.006 + sensitivity * 0.01;
      return Math.max(absoluteMin, this.noiseFloor * multiplier);
    }

    _handleAudioFrame(channelData) {
      if (!this.isListening || this.paused || !this.audioContext) {
        return;
      }

      const frame = new Float32Array(channelData);
      const frameMs = (frame.length / this.audioContext.sampleRate) * 1000;

      let sumSquares = 0;
      for (let i = 0; i < frame.length; i += 1) {
        sumSquares += frame[i] * frame[i];
      }
      const rms = Math.sqrt(sumSquares / frame.length);

      this._emitAudioLevel();

      if (Date.now() < this.cooldownUntil) {
        return;
      }

      const isSpeech = rms > this._speechThreshold();

      if (!this.speaking) {
        if (isSpeech) {
          this.speaking = true;
          this.utterance = this.preRoll.concat([frame]);
          this.utteranceMs = this.preRollMs + frameMs;
          this.speechMs = frameMs;
          this.silenceMs = 0;
          this.preRoll = [];
          this.preRollMs = 0;
          this._emit("interim-transcript", { text: "…" });
          return;
        }

        this.noiseFloor = Math.max(0.001, this.noiseFloor * 0.95 + rms * 0.05);
        this.preRoll.push(frame);
        this.preRollMs += frameMs;
        while (this.preRollMs > PRE_ROLL_MS && this.preRoll.length > 1) {
          const dropped = this.preRoll.shift();
          this.preRollMs -= (dropped.length / this.audioContext.sampleRate) * 1000;
        }
        return;
      }

      this.utterance.push(frame);
      this.utteranceMs += frameMs;
      if (isSpeech) {
        this.speechMs += frameMs;
        this.silenceMs = 0;
      } else {
        this.silenceMs += frameMs;
      }

      if (
        this.silenceMs >= Number(this.settings.vadSilenceMs || 700) ||
        this.utteranceMs >= Number(this.settings.vadMaxUtteranceMs || 15000)
      ) {
        this._finalizeUtterance();
      }
    }

    _emitAudioLevel() {
      const now = Date.now();
      if (!this.analyser || now - this.lastLevelEmitAt < LEVEL_EMIT_INTERVAL_MS) {
        return;
      }
      this.lastLevelEmitAt = now;

      const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
      this.analyser.getByteFrequencyData(dataArray);
      const average =
        dataArray.reduce((a, b) => a + b, 0) / dataArray.length / 255;
      const audioLevel = Math.round(average * 100);

      if (audioLevel > 5) {
        this._emit("audio-level", { level: audioLevel });
      }
    }

    _finalizeUtterance() {
      const frames = this.utterance;
      const speechMs = this.speechMs;
      const sampleRate = this.audioContext.sampleRate;
      this._resetVadState();

      if (speechMs < Number(this.settings.vadMinSpeechMs || 300)) {
        this.logger.debug("Discarding short noise burst", { speechMs });
        return;
      }

      if (this.inflightRequests >= MAX_INFLIGHT_REQUESTS) {
        this.logger.debug("Dropping utterance, transcription backlog full");
        this._emit("ignored", { reason: "busy", transcript: "" });
        return;
      }

      const wav = this._encodeWav(this._downsample(frames, sampleRate));
      this._transcribe(this._toBase64(wav));
    }

    async _transcribe(audioBase64) {
      this.inflightRequests += 1;
      this._emit("interim-transcript", { text: "Transcribing…" });

      let response;
      try {
        response = await chrome.runtime.sendMessage({
          type: Rito.MESSAGE_TYPES.STT_TRANSCRIBE,
          payload: { audioBase64, mimeType: "audio/wav" },
        });
      } catch (error) {
        response = {
          ok: false,
          code: "network",
          error: String(error && error.message),
        };
      } finally {
        this.inflightRequests -= 1;
      }

      if (!this.shouldRun) {
        return;
      }

      if (!response || !response.ok) {
        this._handleTranscriptionError(response || {});
        return;
      }

      this._processTranscript(response.data || {});
    }

    _handleTranscriptionError(response) {
      const code = String(response.code || "network");
      const descriptions = {
        "no-api-key": "Add a Groq API key in Rito settings to enable voice",
        "invalid-api-key": "Groq API key was rejected - check Rito settings",
        rate_limited: "Groq free-tier limit reached - pausing briefly",
        "network-timeout": "Transcription timed out - please try again",
        network: "Network error - check your internet connection",
      };
      const message =
        descriptions[code] || `Speech recognition error: ${response.error}`;

      this.logger.warn(`Transcription failed: ${message}`, response.error);
      this._emit("error", { code, message });

      if (code === "no-api-key" || code === "invalid-api-key") {
        this.stop();
        return;
      }

      if (code === "rate_limited") {
        this.cooldownUntil = Date.now() + Number(response.retryAfterMs || 10000);
        this._resetVadState();
      }
    }

    _processTranscript(result) {
      const transcript = String(result.text || "").trim();
      const confidence = Number(result.confidence || 0);
      const normalized = Rito.fuzzy.normalizeText(transcript);
      const hallucinations = Array.isArray(Rito.STT_HALLUCINATIONS)
        ? Rito.STT_HALLUCINATIONS
        : [];

      if (result.noSpeech || !normalized || hallucinations.includes(normalized)) {
        this.logger.debug("Transcript discarded as non-speech", { transcript });
        this._emit("ignored", { reason: "no_speech", transcript, confidence });
        return;
      }

      this._acceptFinalTranscript(transcript, confidence);
    }

    _applyHotwordGate(originalText) {
      const transcript = String(originalText || "").trim();
      if (!transcript) {
        return { accepted: false, reason: "hotword_required" };
      }

      const activationMode = String(
        this.settings.commandActivationMode || Rito.ACTIVATION_MODES.ALWAYS,
      );

      if (
        activationMode !== Rito.ACTIVATION_MODES.WAKE_PHRASE ||
        this.mode === Rito.COMMAND_MODES.DICTATION
      ) {
        return { accepted: true, text: transcript };
      }

      const normalized = Rito.fuzzy.normalizeText(transcript);
      const now = Date.now();
      const hotword = Rito.fuzzy.normalizeText(
        this.settings.hotword || Rito.DEFAULT_WAKE_PHRASE,
      );

      if (!normalized) {
        return { accepted: false, reason: "hotword_required" };
      }

      if (hotword && normalized === hotword) {
        this.armedUntil = now + 10000;
        this._emit("hotword", {
          hotword: this.settings.hotword || Rito.DEFAULT_WAKE_PHRASE,
          armed: true,
        });
        return { accepted: false, reason: "armed_only" };
      }

      const wakePhrases = this._getWakePhrases();
      const wakeMatch = this._matchWakePrefix(normalized, wakePhrases);

      if (wakeMatch.matched) {
        this.armedUntil = now + 7000;
        this._emit("hotword", {
          hotword: wakeMatch.phrase || Rito.DEFAULT_WAKE_PHRASE,
          armed: true,
        });

        const commandText = this._normalizeWakeCommandText(wakeMatch.remainder);
        if (!commandText) {
          return { accepted: false, reason: "armed_only" };
        }

        return {
          accepted: true,
          text: commandText,
        };
      }

      if (now <= this.armedUntil) {
        return { accepted: true, text: transcript };
      }

      return { accepted: false, reason: "hotword_required" };
    }

    _getWakePhrases() {
      const phrases = new Set();
      const customHotword = Rito.fuzzy.normalizeText(
        this.settings.hotword || "",
      );
      if (customHotword) {
        phrases.add(customHotword);
      }

      const aliases = Array.isArray(Rito.WAKE_PHRASE_ALIASES)
        ? Rito.WAKE_PHRASE_ALIASES
        : [];
      for (const alias of aliases) {
        const normalizedAlias = Rito.fuzzy.normalizeText(alias);
        if (normalizedAlias) {
          phrases.add(normalizedAlias);
        }
      }

      if (!phrases.size) {
        phrases.add(Rito.DEFAULT_WAKE_PHRASE);
      }

      return Array.from(phrases).sort(
        (left, right) => right.length - left.length,
      );
    }

    _matchWakePrefix(normalizedTranscript, wakePhrases) {
      const transcriptTokens = String(normalizedTranscript || "")
        .split(" ")
        .filter(Boolean);

      if (!transcriptTokens.length) {
        return { matched: false, phrase: "", remainder: "" };
      }

      for (const phrase of wakePhrases) {
        const phraseTokens = String(phrase || "")
          .split(" ")
          .filter(Boolean);
        if (
          !phraseTokens.length ||
          transcriptTokens.length < phraseTokens.length
        ) {
          continue;
        }

        const prefix = transcriptTokens.slice(0, phraseTokens.length).join(" ");
        const similarity = Rito.fuzzy.similarityScore(prefix, phrase);
        if (prefix !== phrase && similarity < 0.64) {
          continue;
        }

        const remainder = transcriptTokens
          .slice(phraseTokens.length)
          .join(" ")
          .trim();
        return {
          matched: true,
          phrase,
          remainder,
        };
      }

      // Extra tolerance for split ASR output like: "hay rto", "he ritu".
      if (transcriptTokens.length >= 2) {
        const firstToken = transcriptTokens[0];
        const secondToken = transcriptTokens[1];
        const leadVariants = [
          "hey",
          "hay",
          "hi",
          "hy",
          "he",
          "ei",
          "hello",
          "helo",
          "hullo",
          "ello",
        ];
        const nameVariants = [
          "rito",
          "rto",
          "rita",
          "ritu",
          "rido",
          "rida",
          "reto",
          "retoh",
          "reedo",
          "reeta",
        ];

        const leadKey = this._phoneticWakeKey(firstToken);
        const nameKey = this._phoneticWakeKey(secondToken);
        let leadScore = 0;
        let nameScore = 0;

        for (const variant of leadVariants) {
          leadScore = Math.max(
            leadScore,
            Rito.fuzzy.similarityScore(leadKey, this._phoneticWakeKey(variant)),
          );
        }

        for (const variant of nameVariants) {
          nameScore = Math.max(
            nameScore,
            Rito.fuzzy.similarityScore(nameKey, this._phoneticWakeKey(variant)),
          );
        }

        if (leadScore >= 0.56 && nameScore >= 0.5) {
          return {
            matched: true,
            phrase: `${firstToken} ${secondToken}`,
            remainder: transcriptTokens.slice(2).join(" ").trim(),
          };
        }
      }

      // Some ASR outputs collapse or misspell wake words as a single token,
      // e.g. "hyrita" or "heyrto". Handle those with compact + phonetic scoring.
      const firstToken = transcriptTokens[0] || "";
      const compactFirstToken = this._compactWakeText(firstToken);

      if (compactFirstToken.length >= 4) {
        let best = { score: 0, phrase: "" };

        for (const phrase of wakePhrases) {
          const compactPhrase = this._compactWakeText(phrase);
          if (!compactPhrase) {
            continue;
          }

          const literalScore = Rito.fuzzy.similarityScore(
            compactFirstToken,
            compactPhrase,
          );
          const phoneticScore = Rito.fuzzy.similarityScore(
            this._phoneticWakeKey(compactFirstToken),
            this._phoneticWakeKey(compactPhrase),
          );
          const consonantScore = Rito.fuzzy.similarityScore(
            this._consonantWakeKey(compactFirstToken),
            this._consonantWakeKey(compactPhrase),
          );

          const score = Math.max(literalScore, phoneticScore, consonantScore);
          if (score > best.score) {
            best = { score, phrase };
          }
        }

        if (best.score >= 0.58) {
          return {
            matched: true,
            phrase: best.phrase,
            remainder: transcriptTokens.slice(1).join(" ").trim(),
          };
        }
      }

      return { matched: false, phrase: "", remainder: "" };
    }

    _compactWakeText(value) {
      return Rito.fuzzy.normalizeText(value).replace(/\s+/g, "");
    }

    _phoneticWakeKey(value) {
      return this._compactWakeText(value)
        .replace(/([a-z])\1+/g, "$1")
        .replace(/y/g, "i")
        .replace(/ee|ea|ei|ey|ie|ai|ay/g, "i")
        .replace(/oo|ou|ue|ui/g, "u")
        .replace(/ph/g, "f")
        .replace(/ck/g, "k")
        .replace(/q/g, "k")
        .replace(/x/g, "ks")
        .replace(/[^a-z0-9]/g, "");
    }

    _consonantWakeKey(value) {
      return this._phoneticWakeKey(value)
        .replace(/[aeiou]/g, "")
        .replace(/([a-z0-9])\1+/g, "$1");
    }

    _normalizeWakeCommandText(rawCommand) {
      return String(rawCommand || "")
        .replace(
          /^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:do\s+)?/i,
          "",
        )
        .trim();
    }

    _acceptFinalTranscript(transcript, confidence) {
      const baseSensitivity = Math.max(
        0,
        Math.min(1, this.settings.microphoneSensitivity * 0.5),
      );
      const confidenceBoost =
        String(this.settings.commandActivationMode) ===
          String(Rito.ACTIVATION_MODES.WAKE_PHRASE)
          ? 0.14
          : 0.1;
      const minConfidence = Math.max(0, baseSensitivity - confidenceBoost);
      const gateResult = this._applyHotwordGate(transcript);

      if (!gateResult.accepted) {
        this.logger.debug("Transcript rejected by hotword gate", {
          reason: gateResult.reason,
          transcript,
        });
        this._emit("ignored", {
          reason: gateResult.reason,
          transcript,
          confidence,
        });
        return;
      }

      if (confidence > 0 && confidence < minConfidence) {
        this.logger.debug("Transcript rejected by confidence threshold", {
          transcript,
          confidence,
          minConfidence,
        });
        this._emit("ignored", {
          reason: "low_confidence",
          transcript,
          confidence,
        });
        return;
      }

      this.logger.debug("Final transcript accepted", {
        text: gateResult.text,
        confidence,
      });
      this._emit("final-transcript", {
        text: gateResult.text,
        confidence,
        originalText: transcript,
      });
    }

    _downsample(frames, sourceRate) {
      let totalLength = 0;
      for (const frame of frames) {
        totalLength += frame.length;
      }
      const merged = new Float32Array(totalLength);
      let offset = 0;
      for (const frame of frames) {
        merged.set(frame, offset);
        offset += frame.length;
      }

      if (sourceRate <= TARGET_SAMPLE_RATE) {
        return merged;
      }

      // Box-filter decimation: average the source samples in each output slot.
      const ratio = sourceRate / TARGET_SAMPLE_RATE;
      const outputLength = Math.floor(merged.length / ratio);
      const output = new Float32Array(outputLength);
      for (let i = 0; i < outputLength; i += 1) {
        const start = Math.floor(i * ratio);
        const end = Math.min(merged.length, Math.floor((i + 1) * ratio));
        let sum = 0;
        for (let j = start; j < end; j += 1) {
          sum += merged[j];
        }
        output[i] = sum / Math.max(1, end - start);
      }
      return output;
    }

    _encodeWav(samples) {
      const sampleRate = Math.min(
        TARGET_SAMPLE_RATE,
        this.audioContext ? this.audioContext.sampleRate : TARGET_SAMPLE_RATE,
      );
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);
      const writeString = (position, text) => {
        for (let i = 0; i < text.length; i += 1) {
          view.setUint8(position + i, text.charCodeAt(i));
        }
      };

      writeString(0, "RIFF");
      view.setUint32(4, 36 + samples.length * 2, true);
      writeString(8, "WAVE");
      writeString(12, "fmt ");
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true); // PCM
      view.setUint16(22, 1, true); // mono
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, "data");
      view.setUint32(40, samples.length * 2, true);

      let offset = 44;
      for (let i = 0; i < samples.length; i += 1) {
        const clamped = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(
          offset,
          clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
          true,
        );
        offset += 2;
      }

      return new Uint8Array(buffer);
    }

    _toBase64(bytes) {
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(
          null,
          bytes.subarray(i, i + chunkSize),
        );
      }
      return root.btoa(binary);
    }

    _emit(type, detail) {
      this.dispatchEvent(new CustomEvent(type, { detail: detail || {} }));
    }
  }

  Rito.SpeechEngine = SpeechEngine;
})(typeof globalThis !== "undefined" ? globalThis : window);
