import { ritoGetGroqAction } from "./utils/groq.js";

const RITO_OFFSCREEN_PATH = "offscreen/offscreen.html";
let ritoActiveTabId = null;

/**
 * Rito helper to safely notify any open extension surface.
 * @param {object} ritoMessage Message payload.
 * @returns {Promise<void>}
 */
async function ritoSendRuntimeMessage(ritoMessage) {
  try {
    await chrome.runtime.sendMessage(ritoMessage);
  } catch (ritoError) {
    console.log(
      "[Rito] Runtime message skipped:",
      ritoError?.message || ritoError,
    );
  }
}

/**
 * Rito helper to send status updates to popup UI.
 * @param {{transcript?:string,action?:string,result?:string,status?:string,isError?:boolean}} ritoStatus Status details.
 * @returns {Promise<void>}
 */
async function ritoSendStatusUpdate(ritoStatus) {
  await ritoSendRuntimeMessage({
    type: "RITO_UPDATE_STATUS",
    payload: ritoStatus,
  });
}

/**
 * Rito helper to verify tab URLs that cannot be automated.
 * @param {string|undefined} ritoUrl URL to evaluate.
 * @returns {boolean}
 */
function ritoCanControlUrl(ritoUrl) {
  return Boolean(
    ritoUrl &&
    !/^chrome:\/\//.test(ritoUrl) &&
    !/^chrome-extension:\/\//.test(ritoUrl),
  );
}

/**
 * Rito helper to fetch the active tab.
 * @returns {Promise<chrome.tabs.Tab|null>}
 */
async function ritoGetActiveTab() {
  try {
    const ritoTabs = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    return ritoTabs[0] || null;
  } catch (ritoError) {
    console.log("[Rito] Failed to fetch active tab:", ritoError);
    return null;
  }
}

/**
 * Rito helper to ensure one offscreen document exists for speech recognition.
 * @returns {Promise<void>}
 */
async function createOffscreenDocument() {
  try {
    const ritoContexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(RITO_OFFSCREEN_PATH)],
    });

    if (ritoContexts.length > 0) {
      return;
    }

    await chrome.offscreen.createDocument({
      url: RITO_OFFSCREEN_PATH,
      reasons: ["USER_MEDIA"],
      justification:
        "Rito needs microphone access for voice command recognition",
    });
    console.log("[Rito] Offscreen document created");
  } catch (ritoError) {
    console.log("[Rito] Failed to create offscreen document:", ritoError);
    throw ritoError;
  }
}

/**
 * Rito helper to start listening flow.
 * @param {number|null} ritoRequestedTabId Preferred tab id if known.
 * @returns {Promise<void>}
 */
async function ritoStartListening(ritoRequestedTabId = null) {
  try {
    const ritoTab = ritoRequestedTabId
      ? await chrome.tabs.get(ritoRequestedTabId)
      : await ritoGetActiveTab();

    if (!ritoTab || !ritoTab.id) {
      await ritoSendStatusUpdate({
        action: "none",
        result: "No active tab found",
        status: "error",
        isError: true,
      });
      return;
    }

    if (!ritoCanControlUrl(ritoTab.url)) {
      await ritoSendRuntimeMessage({
        type: "RITO_SPEAK",
        text: "Rito cannot control this page.",
      });
      await ritoSendStatusUpdate({
        action: "none",
        result: "Rito cannot control this page.",
        status: "error",
        isError: true,
      });
      return;
    }

    ritoActiveTabId = ritoTab.id;
    await createOffscreenDocument();
    await chrome.runtime.sendMessage({
      type: "RITO_OFFSCREEN_START_LISTENING",
    });
    await ritoSendRuntimeMessage({
      type: "RITO_LISTENING_STATE",
      listening: true,
    });
    await ritoSendStatusUpdate({
      action: "listening",
      result: "Listening for your command...",
      status: "idle",
    });
  } catch (ritoError) {
    console.log("[Rito] Failed to start listening:", ritoError);
    await ritoSendStatusUpdate({
      action: "none",
      result: "Rito could not start listening.",
      status: "error",
      isError: true,
    });
  }
}

/**
 * Rito helper to stop listening.
 * @returns {Promise<void>}
 */
async function ritoStopListening() {
  try {
    await chrome.runtime.sendMessage({ type: "RITO_OFFSCREEN_STOP_LISTENING" });
    await ritoSendRuntimeMessage({
      type: "RITO_LISTENING_STATE",
      listening: false,
    });
  } catch (ritoError) {
    console.log("[Rito] Failed to stop listening:", ritoError);
  }
}

/**
 * Rito voice command pipeline: context extraction, AI planning, execution, and response.
 * @param {string} ritoTranscript Speech transcript.
 * @param {number|null} ritoTabId Tab id to act on.
 * @returns {Promise<void>}
 */
async function handleTranscript(ritoTranscript, ritoTabId) {
  try {
    const ritoResolvedTabId = ritoTabId || ritoActiveTabId;
    if (!ritoResolvedTabId) {
      await ritoSendStatusUpdate({
        transcript: ritoTranscript,
        action: "none",
        result: "No active tab found",
        status: "error",
        isError: true,
      });
      return;
    }

    const ritoTab = await chrome.tabs.get(ritoResolvedTabId);
    if (!ritoCanControlUrl(ritoTab.url)) {
      await ritoSendRuntimeMessage({
        type: "RITO_SPEAK",
        text: "Rito cannot control this page.",
      });
      await ritoSendStatusUpdate({
        transcript: ritoTranscript,
        action: "none",
        result: "Rito cannot control this page.",
        status: "error",
        isError: true,
      });
      return;
    }

    const ritoContextResponse = await chrome.tabs.sendMessage(
      ritoResolvedTabId,
      {
        type: "RITO_EXTRACT_PAGE_CONTEXT",
      },
    );

    const ritoContext = ritoContextResponse?.context || {
      url: ritoTab.url || "",
      title: ritoTab.title || "",
      headings: [],
      links: [],
      buttons: [],
      inputs: [],
    };

    const ritoAction = await ritoGetGroqAction(ritoTranscript, ritoContext);

    const ritoExecutionResponse = await chrome.tabs.sendMessage(
      ritoResolvedTabId,
      {
        type: "RITO_EXECUTE_ACTION",
        action: ritoAction,
      },
    );

    const ritoResult =
      ritoExecutionResponse?.result ||
      ritoAction.response ||
      "Rito completed your command.";

    const { ritoVoiceRate, ritoVoicePitch } = await chrome.storage.local.get({
      ritoVoiceRate: 1.0,
      ritoVoicePitch: 1.0,
    });

    await ritoSendRuntimeMessage({
      type: "RITO_SPEAK",
      text: ritoResult,
      rate: ritoVoiceRate,
      pitch: ritoVoicePitch,
    });

    await ritoSendStatusUpdate({
      transcript: ritoTranscript,
      action: ritoAction.action || "none",
      result: ritoResult,
      status: ritoAction.action === "none" ? "error" : "success",
      isError: ritoAction.action === "none",
    });
  } catch (ritoError) {
    console.log("[Rito] Transcript pipeline failed:", ritoError);
    const ritoFallback =
      "Rito could not process that command. Please try again.";
    await ritoSendRuntimeMessage({ type: "RITO_SPEAK", text: ritoFallback });
    await ritoSendStatusUpdate({
      transcript: ritoTranscript,
      action: "none",
      result: ritoFallback,
      status: "error",
      isError: true,
    });
  } finally {
    await ritoSendRuntimeMessage({
      type: "RITO_LISTENING_STATE",
      listening: false,
    });
  }
}

chrome.runtime.onMessage.addListener(
  (ritoMessage, ritoSender, ritoSendResponse) => {
    (async () => {
      try {
        switch (ritoMessage?.type) {
          case "RITO_START_LISTENING": {
            const ritoTabId = ritoMessage.tabId || ritoSender?.tab?.id || null;
            await ritoStartListening(ritoTabId);
            ritoSendResponse({ ok: true });
            return;
          }
          case "RITO_STOP_LISTENING": {
            await ritoStopListening();
            ritoSendResponse({ ok: true });
            return;
          }
          case "RITO_SPEECH_RESULT": {
            const ritoTranscript = String(ritoMessage.transcript || "").trim();
            if (!ritoTranscript) {
              await ritoSendStatusUpdate({
                action: "none",
                result: "Rito did not hear a clear command.",
                status: "error",
                isError: true,
              });
              ritoSendResponse({ ok: true });
              return;
            }
            await handleTranscript(ritoTranscript, ritoActiveTabId);
            ritoSendResponse({ ok: true });
            return;
          }
          case "RITO_PROCESS_TRANSCRIPT": {
            const ritoTranscript = String(ritoMessage.transcript || "").trim();
            if (!ritoTranscript) {
              await ritoSendStatusUpdate({
                action: "none",
                result: "Rito did not hear a clear command.",
                status: "error",
                isError: true,
              });
              ritoSendResponse({ ok: true });
              return;
            }

            const ritoActiveTab = await ritoGetActiveTab();
            const ritoTabId = ritoActiveTab?.id || ritoActiveTabId || null;
            if (ritoTabId) {
              ritoActiveTabId = ritoTabId;
            }

            await handleTranscript(ritoTranscript, ritoTabId);
            ritoSendResponse({ ok: true });
            return;
          }
          case "RITO_SPEECH_ERROR": {
            console.log("[Rito] Speech recognition error:", ritoMessage.error);
            const ritoSpeechError = String(ritoMessage.error || "unknown");
            const ritoFriendlyMessage =
              ritoSpeechError === "not-allowed" ||
              ritoSpeechError === "service-not-allowed"
                ? "Microphone access is blocked. Allow microphone access for Rito and try again."
                : `Speech error: ${ritoSpeechError}`;
            await ritoSendStatusUpdate({
              action: "none",
              result: ritoFriendlyMessage,
              status: "error",
              isError: true,
            });
            await ritoSendRuntimeMessage({
              type: "RITO_LISTENING_STATE",
              listening: false,
            });
            ritoSendResponse({ ok: true });
            return;
          }
          case "RITO_SPEECH_END": {
            await ritoSendRuntimeMessage({
              type: "RITO_LISTENING_STATE",
              listening: false,
            });
            ritoSendResponse({ ok: true });
            return;
          }
          default:
            ritoSendResponse({ ok: false });
        }
      } catch (ritoError) {
        console.log("[Rito] Runtime message handler error:", ritoError);
        ritoSendResponse({ ok: false, error: String(ritoError) });
      }
    })();
    return true;
  },
);

chrome.commands.onCommand.addListener(async (ritoCommand) => {
  if (ritoCommand === "toggle-rito") {
    await ritoStartListening();
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.storage.local.set({
      ritoVoiceRate: 1.0,
      ritoVoicePitch: 1.0,
      ritoLanguage: "en-US",
      ritoEnabled: true,
    });
    console.log("[Rito] Initialized default settings");
  } catch (ritoError) {
    console.log("[Rito] Failed to initialize settings:", ritoError);
  }
});
