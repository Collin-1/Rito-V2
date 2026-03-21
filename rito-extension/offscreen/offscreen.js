let ritoRecognition = null;
let ritoListening = false;

/**
 * Rito helper to safely resolve speech language from extension settings.
 * Falls back to en-US if storage APIs are unavailable in offscreen context.
 * @returns {Promise<string>}
 */
async function ritoGetSpeechLanguage() {
  try {
    if (!chrome?.storage?.local?.get) {
      return "en-US";
    }

    const ritoStored = await chrome.storage.local.get({
      ritoLanguage: "en-US",
    });

    return typeof ritoStored.ritoLanguage === "string" &&
      ritoStored.ritoLanguage
      ? ritoStored.ritoLanguage
      : "en-US";
  } catch (ritoError) {
    console.log(
      "[Rito] Failed to read ritoLanguage, using default:",
      ritoError,
    );
    return "en-US";
  }
}

/**
 * Rito helper to initialize and configure SpeechRecognition.
 * @returns {Promise<void>}
 */
async function ritoInitializeRecognition() {
  if (ritoRecognition) {
    return;
  }

  const RitoSpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!RitoSpeechRecognition) {
    throw new Error("SpeechRecognition is not available in this browser.");
  }

  const ritoLanguage = await ritoGetSpeechLanguage();

  ritoRecognition = new RitoSpeechRecognition();
  ritoRecognition.continuous = false;
  ritoRecognition.interimResults = false;
  ritoRecognition.lang = ritoLanguage;
  ritoRecognition.maxAlternatives = 1;

  ritoRecognition.onresult = async (ritoEvent) => {
    const ritoTranscript = ritoEvent?.results?.[0]?.[0]?.transcript || "";
    await chrome.runtime.sendMessage({
      type: "RITO_SPEECH_RESULT",
      transcript: ritoTranscript,
    });
  };

  ritoRecognition.onerror = async (ritoEvent) => {
    await chrome.runtime.sendMessage({
      type: "RITO_SPEECH_ERROR",
      error: ritoEvent.error,
    });
  };

  ritoRecognition.onend = async () => {
    ritoListening = false;
    await chrome.runtime.sendMessage({ type: "RITO_SPEECH_END" });
  };
}

/**
 * Rito helper to begin one-shot listening.
 * @returns {Promise<void>}
 */
async function ritoStartListening() {
  try {
    await ritoInitializeRecognition();
    if (ritoListening || !ritoRecognition) {
      return;
    }
    ritoListening = true;
    ritoRecognition.start();
    console.log("[Rito] Speech recognition started");
  } catch (ritoError) {
    ritoListening = false;
    console.log("[Rito] Speech start failed:", ritoError);
    await chrome.runtime.sendMessage({
      type: "RITO_SPEECH_ERROR",
      error: String(ritoError),
    });
  }
}

/**
 * Rito helper to stop listening.
 * @returns {Promise<void>}
 */
async function ritoStopListening() {
  try {
    if (ritoRecognition && ritoListening) {
      ritoRecognition.stop();
    }
  } catch (ritoError) {
    console.log("[Rito] Speech stop failed:", ritoError);
    await chrome.runtime.sendMessage({
      type: "RITO_SPEECH_ERROR",
      error: String(ritoError),
    });
  }
}

chrome.runtime.onMessage.addListener(
  (ritoMessage, _ritoSender, ritoSendResponse) => {
    (async () => {
      try {
        if (ritoMessage?.type === "RITO_OFFSCREEN_START_LISTENING") {
          await ritoStartListening();
          ritoSendResponse({ ok: true });
          return;
        }

        if (ritoMessage?.type === "RITO_OFFSCREEN_STOP_LISTENING") {
          await ritoStopListening();
          ritoSendResponse({ ok: true });
          return;
        }

        ritoSendResponse({ ok: false });
      } catch (ritoError) {
        console.log("[Rito] Offscreen message handler error:", ritoError);
        ritoSendResponse({ ok: false, error: String(ritoError) });
      }
    })();

    return true;
  },
);
