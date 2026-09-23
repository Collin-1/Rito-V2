(function initRitoPopup(globalScope) {
  const root = globalScope || globalThis;
  const MESSAGE_TYPES = (root.Rito && root.Rito.MESSAGE_TYPES) || {
    GET_STATUS: "RITO_GET_STATUS",
    SET_LISTENING: "RITO_SET_LISTENING",
    SET_MODE: "RITO_SET_MODE",
    SHOW_NUMBERS: "RITO_SHOW_NUMBERS",
    HIDE_NUMBERS: "RITO_HIDE_NUMBERS",
  };

  const state = {
    tabId: null,
    mode: "commands",
    listening: false,
  };

  const elements = {
    statusText: root.document.getElementById("statusText"),
    modeText: root.document.getElementById("modeText"),
    toggleListeningBtn: root.document.getElementById("toggleListeningBtn"),
    commandsModeBtn: root.document.getElementById("commandsModeBtn"),
    dictationModeBtn: root.document.getElementById("dictationModeBtn"),
    showNumbersBtn: root.document.getElementById("showNumbersBtn"),
    hideNumbersBtn: root.document.getElementById("hideNumbersBtn"),
    openSettingsBtn: root.document.getElementById("openSettingsBtn"),
  };

  function updateUI() {
    elements.modeText.textContent = `Mode: ${state.mode}`;
    elements.toggleListeningBtn.textContent = state.listening
      ? "Stop listening"
      : "Start listening";
    elements.statusText.textContent = state.listening
      ? "Listening on this tab"
      : "Listening is paused";
  }

  async function getActiveTabId() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs.length || !Number.isInteger(tabs[0].id)) {
      throw new Error("No active browser tab found.");
    }
    state.tabId = tabs[0].id;
    return state.tabId;
  }

  async function sendToTab(type, payload) {
    if (!Number.isInteger(state.tabId)) {
      await getActiveTabId();
    }

    return chrome.tabs.sendMessage(state.tabId, {
      type,
      payload: payload || {},
    });
  }

  async function refreshStatus() {
    try {
      await getActiveTabId();
      const response = await sendToTab(MESSAGE_TYPES.GET_STATUS);
      if (!response || !response.ok) {
        throw new Error("Voice controller is unavailable on this page.");
      }

      state.mode = response.data.mode || "commands";
      state.listening = Boolean(response.data.listening);
      updateUI();
    } catch (_error) {
      elements.statusText.textContent = "Rito is unavailable on this page";
      elements.modeText.textContent = "Try a regular website tab";
    }
  }

  async function setListening(listening) {
    await sendToTab(MESSAGE_TYPES.SET_LISTENING, { listening });
    state.listening = listening;
    updateUI();
  }

  async function setMode(mode) {
    await sendToTab(MESSAGE_TYPES.SET_MODE, { mode });
    state.mode = mode;
    updateUI();
  }

  function wireEvents() {
    elements.toggleListeningBtn.addEventListener("click", () => {
      setListening(!state.listening).catch(() => {
        elements.statusText.textContent = "Unable to change listening state";
      });
    });

    elements.commandsModeBtn.addEventListener("click", () => {
      setMode("commands").catch(() => {
        elements.statusText.textContent = "Unable to switch to commands mode";
      });
    });

    elements.dictationModeBtn.addEventListener("click", () => {
      setMode("dictation").catch(() => {
        elements.statusText.textContent = "Unable to switch to dictation mode";
      });
    });

    elements.showNumbersBtn.addEventListener("click", () => {
      sendToTab(MESSAGE_TYPES.SHOW_NUMBERS).catch(() => {
        elements.statusText.textContent = "Unable to show number hints";
      });
    });

    elements.hideNumbersBtn.addEventListener("click", () => {
      sendToTab(MESSAGE_TYPES.HIDE_NUMBERS).catch(() => {
        elements.statusText.textContent = "Unable to hide number hints";
      });
    });

    elements.openSettingsBtn.addEventListener("click", () => {
      chrome.runtime.openOptionsPage();
    });
  }

  wireEvents();
  refreshStatus();
})(typeof globalThis !== "undefined" ? globalThis : window);
