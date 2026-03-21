import { speak } from "../utils/tts.js";

const ritoMicButton = document.getElementById("ritoMicButton");
const ritoMicLabel = document.getElementById("ritoMicLabel");
const ritoMicDot = document.getElementById("ritoMicDot");
const ritoTranscript = document.getElementById("ritoTranscript");
const ritoAction = document.getElementById("ritoAction");
const ritoStatusText = document.getElementById("ritoStatusText");
const ritoStatusDot = document.getElementById("ritoStatusDot");
const ritoManualCommandInput = document.getElementById("ritoManualCommand");
const ritoSendCommandButton = document.getElementById("ritoSendCommand");
const ritoApiKeyInput = document.getElementById("ritoApiKey");
const ritoSaveKeyButton = document.getElementById("ritoSaveKey");
const ritoKeyWarning = document.getElementById("ritoKeyWarning");

let ritoIsListening = false;
let ritoPopupRecognition = null;

/**
 * Rito helper to explicitly request microphone access from a direct user click.
 * @returns {Promise<boolean>}
 */
async function ritoRequestMicPermission() {
  try {
    if (!navigator?.mediaDevices?.getUserMedia) {
      return true;
    }

    const ritoStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    ritoStream.getTracks().forEach((ritoTrack) => ritoTrack.stop());
    return true;
  } catch (ritoError) {
    console.log(
      "[Rito] Explicit microphone permission request failed:",
      ritoError,
    );
    if (ritoError?.name === "NotAllowedError") {
      ritoSetStatus(
        "error",
        "Microphone permission denied. Allow it for this extension and try again",
      );
    } else {
      ritoSetStatus(
        "error",
        `Microphone error: ${ritoError?.name || "unknown"}`,
      );
    }
    return false;
  }
}

/**
 * Rito helper to create SpeechRecognition in popup context.
 * Keeps construction synchronous so start() can be called from a direct click.
 * @returns {SpeechRecognition|null}
 */
function ritoGetPopupRecognition() {
  if (ritoPopupRecognition) {
    return ritoPopupRecognition;
  }

  const RitoSpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!RitoSpeechRecognition) {
    return null;
  }

  ritoPopupRecognition = new RitoSpeechRecognition();
  ritoPopupRecognition.continuous = false;
  ritoPopupRecognition.interimResults = false;
  ritoPopupRecognition.lang = "en-US";
  ritoPopupRecognition.maxAlternatives = 1;

  // Load preferred language asynchronously without blocking click-triggered start.
  chrome.storage.local
    .get({ ritoLanguage: "en-US" })
    .then(({ ritoLanguage }) => {
      if (ritoPopupRecognition) {
        ritoPopupRecognition.lang = ritoLanguage || "en-US";
      }
    })
    .catch((ritoError) => {
      console.log(
        "[Rito] Failed to load ritoLanguage for popup recognition:",
        ritoError,
      );
    });

  ritoPopupRecognition.onresult = async (ritoEvent) => {
    const ritoHeardTranscript = String(
      ritoEvent?.results?.[0]?.[0]?.transcript || "",
    ).trim();
    if (!ritoHeardTranscript) {
      ritoSetStatus("error", "Rito did not hear a clear command");
      return;
    }

    ritoTranscript.textContent = `"${ritoHeardTranscript}"`;
    await chrome.runtime.sendMessage({
      type: "RITO_PROCESS_TRANSCRIPT",
      transcript: ritoHeardTranscript,
    });
  };

  ritoPopupRecognition.onerror = (ritoEvent) => {
    const ritoError = String(ritoEvent?.error || "unknown");
    if (ritoError === "not-allowed" || ritoError === "service-not-allowed") {
      ritoSetStatus(
        "error",
        "Microphone blocked. Check Chrome and Windows microphone privacy settings",
      );
    } else {
      ritoSetStatus("error", `Speech error: ${ritoError}`);
    }
  };

  ritoPopupRecognition.onend = () => {
    ritoSetListeningUi(false);
  };

  return ritoPopupRecognition;
}

/**
 * Rito helper to start popup-local speech recognition.
 * @returns {boolean}
 */
function ritoStartPopupListening() {
  const ritoRecognition = ritoGetPopupRecognition();
  if (!ritoRecognition) {
    ritoSetStatus(
      "error",
      "SpeechRecognition is not available in this browser",
    );
    return false;
  }

  try {
    ritoRecognition.start();
    return true;
  } catch (ritoError) {
    console.log("[Rito] Popup speech start failed:", ritoError);
    ritoSetStatus("error", "Could not start speech recognition");
    return false;
  }
}

/**
 * Rito helper to stop popup-local speech recognition.
 * @returns {void}
 */
function ritoStopPopupListening() {
  try {
    ritoPopupRecognition?.stop();
  } catch (ritoError) {
    console.log("[Rito] Popup speech stop failed:", ritoError);
  }
}

/**
 * Rito UI helper for mic button state.
 * @param {boolean} ritoListening Whether Rito is currently listening.
 */
function ritoSetListeningUi(ritoListening) {
  ritoIsListening = ritoListening;
  ritoMicButton.classList.toggle("rito-listening", ritoListening);
  ritoMicDot.classList.toggle("rito-dot-listening", ritoListening);
  ritoMicLabel.textContent = ritoListening ? "Listening..." : "Start listening";
}

/**
 * Rito UI helper for status dot and text.
 * @param {'idle'|'success'|'error'} ritoStatus Visual status.
 * @param {string} ritoText Display text.
 */
function ritoSetStatus(ritoStatus, ritoText) {
  ritoStatusDot.classList.remove(
    "rito-status-idle",
    "rito-status-success",
    "rito-status-error",
  );

  if (ritoStatus === "success") {
    ritoStatusDot.classList.add("rito-status-success");
  } else if (ritoStatus === "error") {
    ritoStatusDot.classList.add("rito-status-error");
  } else {
    ritoStatusDot.classList.add("rito-status-idle");
  }

  ritoStatusText.textContent = ritoText;
}

/**
 * Rito helper to save API key in local storage.
 * @returns {Promise<void>}
 */
async function ritoSaveApiKey() {
  const ritoGroqApiKey = ritoApiKeyInput.value.trim();
  await chrome.storage.local.set({ ritoGroqApiKey });
  ritoKeyWarning.hidden = Boolean(ritoGroqApiKey);
  ritoSetStatus("success", "API key saved");
}

/**
 * Rito helper to submit a typed command through the same processing pipeline.
 * @returns {Promise<void>}
 */
async function ritoSendTypedCommand() {
  const ritoTypedCommand = String(ritoManualCommandInput?.value || "").trim();
  if (!ritoTypedCommand) {
    ritoSetStatus("error", "Type a command first");
    return;
  }

  ritoTranscript.textContent = `"${ritoTypedCommand}"`;
  ritoSetStatus("idle", "Processing command...");
  await chrome.runtime.sendMessage({
    type: "RITO_PROCESS_TRANSCRIPT",
    transcript: ritoTypedCommand,
  });
  ritoManualCommandInput.value = "";
}

/**
 * Rito popup bootstrap routine.
 * @returns {Promise<void>}
 */
async function ritoInitializePopup() {
  try {
    const { ritoGroqApiKey } = await chrome.storage.local.get({
      ritoGroqApiKey: "",
    });
    if (ritoGroqApiKey) {
      ritoApiKeyInput.value = ritoGroqApiKey;
      ritoKeyWarning.hidden = true;
    } else {
      ritoKeyWarning.hidden = false;
    }

    ritoSetStatus("idle", "Idle");
  } catch (ritoError) {
    console.log("[Rito] Popup initialization error:", ritoError);
    ritoSetStatus("error", "Failed to load settings");
  }
}

ritoSaveKeyButton.addEventListener("click", async () => {
  try {
    await ritoSaveApiKey();
  } catch (ritoError) {
    console.log("[Rito] Save key failed:", ritoError);
    ritoSetStatus("error", "Could not save API key");
  }
});

ritoMicButton.addEventListener("click", async () => {
  try {
    if (ritoIsListening) {
      ritoStopPopupListening();
      ritoSetListeningUi(false);
      ritoSetStatus("idle", "Stopped");
      return;
    }

    ritoSetStatus("idle", "Requesting microphone permission...");
    const ritoMicPermissionGranted = await ritoRequestMicPermission();
    if (!ritoMicPermissionGranted) {
      ritoSetListeningUi(false);
      return;
    }

    ritoSetListeningUi(true);
    ritoSetStatus("idle", "Listening...");
    const ritoStarted = ritoStartPopupListening();
    if (!ritoStarted) {
      ritoSetListeningUi(false);
    }
  } catch (ritoError) {
    console.log("[Rito] Start listening failed:", ritoError);
    ritoSetListeningUi(false);
    ritoSetStatus("error", "Could not start listening");
  }
});

ritoSendCommandButton.addEventListener("click", async () => {
  try {
    await ritoSendTypedCommand();
  } catch (ritoError) {
    console.log("[Rito] Typed command send failed:", ritoError);
    ritoSetStatus("error", "Could not send typed command");
  }
});

ritoManualCommandInput.addEventListener("keydown", async (ritoEvent) => {
  if (ritoEvent.key !== "Enter") {
    return;
  }
  ritoEvent.preventDefault();
  try {
    await ritoSendTypedCommand();
  } catch (ritoError) {
    console.log("[Rito] Typed command enter failed:", ritoError);
    ritoSetStatus("error", "Could not send typed command");
  }
});

chrome.runtime.onMessage.addListener((ritoMessage) => {
  if (ritoMessage?.type === "RITO_UPDATE_STATUS") {
    const ritoPayload = ritoMessage.payload || {};
    if (ritoPayload.transcript) {
      ritoTranscript.textContent = `"${ritoPayload.transcript}"`;
    }

    if (ritoPayload.action) {
      ritoAction.textContent = ritoPayload.action;
    }

    if (ritoPayload.status === "success") {
      ritoSetStatus("success", ritoPayload.result || "Done");
    } else if (ritoPayload.status === "error") {
      ritoSetStatus("error", ritoPayload.result || "Error");
    } else {
      ritoSetStatus("idle", ritoPayload.result || "Idle");
    }

    ritoSetListeningUi(false);
  }

  if (ritoMessage?.type === "RITO_LISTENING_STATE") {
    ritoSetListeningUi(Boolean(ritoMessage.listening));
  }

  if (ritoMessage?.type === "RITO_SPEAK") {
    speak(
      ritoMessage.text || "",
      ritoMessage.rate || 1.0,
      ritoMessage.pitch || 1.0,
    );
  }
});

ritoInitializePopup();
