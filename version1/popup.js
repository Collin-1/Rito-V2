const commandInput = document.getElementById("commandInput");
const runButton = document.getElementById("runButton");
const speakButton = document.getElementById("speakButton");
const speechStatus = document.getElementById("speechStatus");
const statusMessage = document.getElementById("statusMessage");
const resultBox = document.getElementById("resultBox");
const wakeIndicator = document.getElementById("wakeIndicator");

let indicatorTimerId = null;

function hideWakeIndicator() {
  wakeIndicator.classList.remove("visible");
}

function showWakeIndicator(text, autoHideMs = 0) {
  wakeIndicator.innerText = text;
  wakeIndicator.classList.add("visible");

  if (indicatorTimerId) {
    clearTimeout(indicatorTimerId);
    indicatorTimerId = null;
  }

  if (autoHideMs > 0) {
    indicatorTimerId = setTimeout(() => {
      hideWakeIndicator();
    }, autoHideMs);
  }
}

function hasWakeWord(text) {
  return (
    text.includes("rito") || text.includes("ritu") || text.includes("rido")
  );
}

function extractCommandAfterWakeWord(text) {
  const wakeWords = ["rito", "ritu", "rido"];
  let earliestIndex = -1;
  let matchedWake = "";

  for (const wakeWord of wakeWords) {
    const index = text.indexOf(wakeWord);
    if (index !== -1 && (earliestIndex === -1 || index < earliestIndex)) {
      earliestIndex = index;
      matchedWake = wakeWord;
    }
  }

  if (earliestIndex === -1) {
    return "";
  }

  const afterWake = text
    .slice(earliestIndex + matchedWake.length)
    .replace(/^\s*[-,:]?\s*/, "")
    .trim();

  return afterWake;
}

function runCommand(onComplete) {
  const command = commandInput.value;

  console.log("Sending command:", command);
  resultBox.textContent = "Running...";

  chrome.runtime.sendMessage({ command }, (response) => {
    if (chrome.runtime.lastError) {
      statusMessage.textContent = `Failed to send command: ${chrome.runtime.lastError.message}`;
      resultBox.textContent = "";
      if (onComplete) {
        onComplete();
      }
      return;
    }

    statusMessage.textContent = response?.status || "Command sent.";
    resultBox.textContent =
      response?.result || response?.status || "No response.";
    if (onComplete) {
      onComplete();
    }
  });
}

runButton.addEventListener("click", () => {
  runCommand();
});

if ("webkitSpeechRecognition" in window) {
  const recognition = new webkitSpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let isRecognizing = false;
  let isStartingRecognition = false;
  let shouldRestartRecognition = true;
  let waitingForNextPhrase = false;
  let abortedCount = 0;
  let restartDelayMs = 500;
  let restartTimerId = null;
  let stableStartTimerId = null;
  let micBusyMode = false;
  let lastStartAt = 0;

  function startVoiceRecognition() {
    if (isRecognizing || isStartingRecognition) {
      return;
    }

    try {
      isStartingRecognition = true;
      recognition.start();
    } catch (error) {
      isStartingRecognition = false;
      statusMessage.textContent = `Speech start error: ${error.message}`;
    }
  }

  function processVoiceCommand(command) {
    const cleaned = (command || "").trim();
    if (!cleaned) {
      return;
    }

    console.log(`Command: ${cleaned}`);
    commandInput.value = cleaned;
    speechStatus.textContent = "Processing...";
    waitingForNextPhrase = false;
    runCommand(() => {
      speechStatus.textContent = "Listening...";
      showWakeIndicator("Listening...", 2500);
    });
  }

  speakButton.addEventListener("click", () => {
    statusMessage.textContent = "";
    shouldRestartRecognition = true;
    abortedCount = 0;
    restartDelayMs = 500;
    if (restartTimerId) {
      clearTimeout(restartTimerId);
      restartTimerId = null;
    }
    startVoiceRecognition();
  });

  recognition.onstart = () => {
    isRecognizing = true;
    isStartingRecognition = false;
    lastStartAt = Date.now();
    speechStatus.textContent = "Listening...";
    showWakeIndicator("Listening...");
    console.log("Listening...");

    if (stableStartTimerId) {
      clearTimeout(stableStartTimerId);
      stableStartTimerId = null;
    }

    // If recognition remains stable for a few seconds, clear abort backoff.
    stableStartTimerId = setTimeout(() => {
      abortedCount = 0;
      restartDelayMs = 500;
      micBusyMode = false;
      statusMessage.textContent = "";
    }, 4000);
  };

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcript = result[0]?.transcript?.trim() || "";
      const transcriptLower = transcript.toLowerCase();

      if (!transcriptLower) {
        continue;
      }

      // We received actual transcript data, so clear abort streak.
      abortedCount = 0;
      micBusyMode = false;

      console.log(`Transcript: ${transcriptLower}`);

      if (!result.isFinal) {
        if (!waitingForNextPhrase && hasWakeWord(transcriptLower)) {
          console.log("Wake word detected");
          showWakeIndicator(`🎤 Heard: ${transcript}`);
          setTimeout(() => {
            if (waitingForNextPhrase) {
              showWakeIndicator("Listening for command...");
            }
          }, 600);
          waitingForNextPhrase = true;
          speechStatus.textContent = "Listening for command...";
        }
        continue;
      }

      if (hasWakeWord(transcriptLower)) {
        console.log("Wake word detected");
        showWakeIndicator(`🎤 Heard: ${transcript}`);
        const inlineCommand = extractCommandAfterWakeWord(transcriptLower);

        if (inlineCommand) {
          processVoiceCommand(inlineCommand);
        } else {
          waitingForNextPhrase = true;
          speechStatus.textContent = "Listening for command...";
          setTimeout(() => {
            if (waitingForNextPhrase) {
              showWakeIndicator("Listening for command...");
            }
          }, 600);
        }
        continue;
      }

      if (waitingForNextPhrase) {
        processVoiceCommand(transcriptLower);
        continue;
      }
    }
  };

  recognition.onerror = (event) => {
    if (event.error === "audio-capture") {
      micBusyMode = true;
      restartDelayMs = 12000;
      speechStatus.textContent = "Mic busy, waiting...";
      statusMessage.textContent =
        "Microphone is in use by another tab/app. Waiting and retrying automatically.";
      console.log("Speech error: audio-capture (mic busy)");
      return;
    }

    if (event.error === "aborted") {
      abortedCount += 1;
      console.log(`Speech error: aborted (${abortedCount})`);

      const quickAbort = Date.now() - lastStartAt < 1800;
      if (quickAbort && abortedCount >= 2) {
        micBusyMode = true;
        restartDelayMs = 12000;
        speechStatus.textContent = "Mic busy, waiting...";
        statusMessage.textContent =
          "Microphone appears to be in use by another tab/app. Waiting and retrying automatically.";
      } else {
        speechStatus.textContent = "Reconnecting voice...";
        statusMessage.textContent = "Voice interrupted. Reconnecting...";
        restartDelayMs = Math.min(500 * 2 ** Math.min(abortedCount, 6), 20000);
      }
      return;
    }

    console.log(`Speech error: ${event.error}`);

    if (event.error === "not-allowed") {
      shouldRestartRecognition = false;
      speechStatus.textContent = "Voice blocked";
      statusMessage.textContent =
        "Microphone permission was blocked or dismissed. In Chrome settings, allow Microphone access, then reopen the extension popup and try again.";
      return;
    }

    statusMessage.textContent = `Speech error: ${event.error}`;
  };

  recognition.onend = () => {
    isRecognizing = false;
    isStartingRecognition = false;
    if (stableStartTimerId) {
      clearTimeout(stableStartTimerId);
      stableStartTimerId = null;
    }
    if (!shouldRestartRecognition) {
      speechStatus.textContent = "Voice paused";
      hideWakeIndicator();
      return;
    }

    showWakeIndicator(micBusyMode ? "Mic busy, retrying..." : "Listening...");
    restartTimerId = setTimeout(() => {
      startVoiceRecognition();
    }, restartDelayMs);
  };

  speechStatus.textContent = "Starting voice listening...";
  showWakeIndicator("Starting voice listening...");
  startVoiceRecognition();
} else {
  speakButton.disabled = true;
  statusMessage.textContent =
    "Speech recognition is not supported in this browser.";
}
