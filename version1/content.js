const RITO_WAKE_TERMS = ["rito", "ritu", "rido", "rto", "reto"];

function hasWakeWord(text) {
  if (!text) {
    return false;
  }

  const lower = text.toLowerCase();
  if (
    lower.includes("harito") ||
    lower.includes("heyrito") ||
    lower.includes("heyrto") ||
    lower.includes("heyreto")
  ) {
    return true;
  }

  return RITO_WAKE_TERMS.some((term) => lower.includes(term));
}

function extractCommandAfterWakeWord(text) {
  const lowerText = String(text || "").toLowerCase();

  if (lowerText.includes("harito")) {
    return lowerText
      .slice(lowerText.indexOf("harito") + "harito".length)
      .replace(/^\s*[-,:]?\s*/, "")
      .trim();
  }

  if (lowerText.includes("heyrito")) {
    return lowerText
      .slice(lowerText.indexOf("heyrito") + "heyrito".length)
      .replace(/^\s*[-,:]?\s*/, "")
      .trim();
  }

  if (lowerText.includes("heyrto")) {
    return lowerText
      .slice(lowerText.indexOf("heyrto") + "heyrto".length)
      .replace(/^\s*[-,:]?\s*/, "")
      .trim();
  }

  if (lowerText.includes("heyreto")) {
    return lowerText
      .slice(lowerText.indexOf("heyreto") + "heyreto".length)
      .replace(/^\s*[-,:]?\s*/, "")
      .trim();
  }

  let earliestIndex = -1;
  let matchedTerm = "";

  for (const term of RITO_WAKE_TERMS) {
    const index = lowerText.indexOf(term);
    if (index !== -1 && (earliestIndex === -1 || index < earliestIndex)) {
      earliestIndex = index;
      matchedTerm = term;
    }
  }

  if (earliestIndex === -1) {
    return "";
  }

  return lowerText
    .slice(earliestIndex + matchedTerm.length)
    .replace(/^\s*[-,:]?\s*/, "")
    .trim();
}

function setWakeDotState(wakeDot, state) {
  if (!wakeDot) {
    return;
  }

  wakeDot.classList.toggle("wake-detected", state === "wake");
}

function injectRitoStyles() {
  if (document.getElementById("rito-style")) {
    return;
  }

  const style = document.createElement("style");
  style.id = "rito-style";
  style.textContent = `
    #rito-ui {
      position: fixed;
      right: 16px;
      bottom: 16px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      opacity: 0;
      transform: translateY(8px);
      animation: rito-fade-in 220ms ease-out forwards;
      font-family: Arial, sans-serif;
    }

    #rito-listening-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #2e86ff;
      box-shadow: 0 0 0 rgba(46, 134, 255, 0.45);
      animation: rito-pulse 1.3s infinite;
      transition: background-color 180ms ease;
    }

    #rito-listening-dot.wake-detected {
      background: #ff9f1a;
      box-shadow: 0 0 0 rgba(255, 159, 26, 0.45);
    }

    #rito-button {
      border: none;
      border-radius: 999px;
      background: #111827;
      color: #fff;
      padding: 10px 14px;
      font-size: 13px;
      font-weight: 600;
      cursor: default;
      transform: scale(1);
      transition: transform 140ms ease, box-shadow 140ms ease;
      box-shadow: 0 8px 22px rgba(0, 0, 0, 0.22);
    }

    #rito-button:hover {
      transform: scale(1.03);
    }

    #rito-button:active {
      transform: scale(0.97);
    }

    @keyframes rito-pulse {
      0% {
        box-shadow: 0 0 0 0 rgba(46, 134, 255, 0.45);
        opacity: 1;
      }
      70% {
        box-shadow: 0 0 0 10px rgba(46, 134, 255, 0);
        opacity: 0.75;
      }
      100% {
        box-shadow: 0 0 0 0 rgba(46, 134, 255, 0);
        opacity: 1;
      }
    }

    @keyframes rito-fade-in {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `;
  document.documentElement.appendChild(style);
}

function ensureRitoUi() {
  if (document.getElementById("rito-button")) {
    return {
      wakeDot: document.getElementById("rito-listening-dot"),
    };
  }

  injectRitoStyles();

  const container = document.createElement("div");
  container.id = "rito-ui";

  const wakeDot = document.createElement("div");
  wakeDot.id = "rito-listening-dot";

  const button = document.createElement("button");
  button.id = "rito-button";
  button.type = "button";
  button.textContent = "Rito";

  container.appendChild(wakeDot);
  container.appendChild(button);
  document.documentElement.appendChild(container);

  return { wakeDot };
}

function initializeContentSpeechRecognition() {
  const { wakeDot } = ensureRitoUi();
  const ritoButton = document.getElementById("rito-button");
  const TAKEOVER_RETRY_MS = 250;

  if (!("webkitSpeechRecognition" in window)) {
    console.log("Rito speech recognition is not supported on this page.");
    return;
  }

  if (window.__ritoRecognitionInitialized) {
    return;
  }

  window.__ritoRecognitionInitialized = true;

  const recognition = new webkitSpeechRecognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let isRecognizing = false;
  let isStarting = false;
  let shouldRestart = true;
  let waitingForCommand = false;
  let wakeHeardAt = 0;
  let lastWakeDetectedAt = 0;
  let commandCooldownUntil = 0;
  let restartDelayMs = TAKEOVER_RETRY_MS;
  let restartTimerId = null;
  let micBusyMode = false;
  const WAKE_LOG_COOLDOWN_MS = 1200;
  const COMMAND_COOLDOWN_MS = 2500;

  function setRitoButtonLabel(text) {
    if (!ritoButton) {
      return;
    }
    ritoButton.textContent = text;
  }

  function startRecognition() {
    if (isRecognizing || isStarting) {
      return;
    }

    if (document.hidden) {
      return;
    }

    try {
      isStarting = true;
      recognition.start();
    } catch (error) {
      isStarting = false;
      console.log("Rito speech start error:", error.message);
    }
  }

  recognition.onstart = () => {
    isRecognizing = true;
    isStarting = false;
    micBusyMode = false;
    restartDelayMs = TAKEOVER_RETRY_MS;
    setRitoButtonLabel("Rito");
    console.log("Listening...");
  };

  recognition.onresult = (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const transcriptRaw = result[0]?.transcript?.trim() || "";
      const transcript = transcriptRaw.toLowerCase();
      const now = Date.now();

      if (!transcript) {
        continue;
      }

      if (now < commandCooldownUntil) {
        continue;
      }

      if (result.isFinal) {
        console.log("Transcript:", transcript);
      }

      if (waitingForCommand && now - wakeHeardAt > 8000) {
        waitingForCommand = false;
      }

      const wakeDetected = hasWakeWord(transcript);
      const inlineCommand = wakeDetected
        ? extractCommandAfterWakeWord(transcript)
        : "";

      if (!result.isFinal) {
        if (!waitingForCommand && wakeDetected) {
          if (now - lastWakeDetectedAt < WAKE_LOG_COOLDOWN_MS) {
            continue;
          }

          lastWakeDetectedAt = now;
          setWakeDotState(wakeDot, "wake");
          console.log("Wake word detected");
          waitingForCommand = true;
          wakeHeardAt = now;
          setTimeout(() => {
            setWakeDotState(wakeDot, "listening");
          }, 900);
        }
        continue;
      }

      if (wakeDetected && inlineCommand) {
        if (now - lastWakeDetectedAt >= WAKE_LOG_COOLDOWN_MS) {
          lastWakeDetectedAt = now;
          console.log("Wake word detected");
        }
        setWakeDotState(wakeDot, "wake");
        console.log("Command:", inlineCommand);
        chrome.runtime.sendMessage({ command: inlineCommand });
        waitingForCommand = false;
        commandCooldownUntil = now + COMMAND_COOLDOWN_MS;
        setTimeout(() => {
          setWakeDotState(wakeDot, "listening");
        }, 1200);
        continue;
      }

      if (wakeDetected && !waitingForCommand) {
        if (now - lastWakeDetectedAt < WAKE_LOG_COOLDOWN_MS) {
          continue;
        }

        lastWakeDetectedAt = now;
        setWakeDotState(wakeDot, "wake");
        console.log("Wake word detected");
        waitingForCommand = true;
        wakeHeardAt = now;
        setTimeout(() => {
          setWakeDotState(wakeDot, "listening");
        }, 1200);
        continue;
      }

      if (waitingForCommand) {
        if (wakeDetected) {
          continue;
        }

        console.log("Command:", transcript);
        chrome.runtime.sendMessage({ command: transcript });
        waitingForCommand = false;
        commandCooldownUntil = now + COMMAND_COOLDOWN_MS;
      }
    }
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed") {
      shouldRestart = false;
      setRitoButtonLabel("Rito blocked");
      console.log("Rito speech blocked by permission.");
      return;
    }

    if (event.error === "audio-capture") {
      micBusyMode = true;
      restartDelayMs = TAKEOVER_RETRY_MS;
      setRitoButtonLabel("Rito (taking over)");
      console.log("Rito speech error: audio-capture. Taking over mic...");
      return;
    }

    if (event.error === "aborted") {
      micBusyMode = true;
      restartDelayMs = TAKEOVER_RETRY_MS;
      setRitoButtonLabel("Rito (taking over)");
      console.log("Rito speech error: aborted. Taking over mic...");
      return;
    }

    console.log("Rito speech error:", event.error);
  };

  recognition.onend = () => {
    isRecognizing = false;
    isStarting = false;

    if (restartTimerId) {
      clearTimeout(restartTimerId);
      restartTimerId = null;
    }

    if (!shouldRestart) {
      return;
    }

    if (document.hidden) {
      return;
    }

    if (micBusyMode) {
      setRitoButtonLabel("Rito (taking over)");
    }

    restartTimerId = setTimeout(() => {
      startRecognition();
    }, restartDelayMs);
  };

  function stopRecognitionForHandoff() {
    shouldRestart = false;
    isStarting = false;

    if (restartTimerId) {
      clearTimeout(restartTimerId);
      restartTimerId = null;
    }

    if (isRecognizing) {
      try {
        recognition.stop();
      } catch {
        // Ignore stop race errors.
      }
    }

    setRitoButtonLabel("Rito");
  }

  function resumeRecognitionAfterHandoff() {
    shouldRestart = true;
    restartDelayMs = TAKEOVER_RETRY_MS;
    startRecognition();
  }

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopRecognitionForHandoff();
    } else {
      resumeRecognitionAfterHandoff();
    }
  });

  window.addEventListener("pagehide", () => {
    stopRecognitionForHandoff();
  });

  window.addEventListener("beforeunload", () => {
    stopRecognitionForHandoff();
  });

  startRecognition();
}

const ENABLE_CONTENT_VOICE = true;

if (ENABLE_CONTENT_VOICE) {
  initializeContentSpeechRecognition();
}

function createRitoUI() {
  const existingButton = document.getElementById("rito-button");
  if (existingButton) {
    existingButton.textContent = "Rito";
    existingButton.style.setProperty("position", "fixed", "important");
    existingButton.style.setProperty("bottom", "20px", "important");
    existingButton.style.setProperty("right", "20px", "important");
    existingButton.style.setProperty("background", "black", "important");
    existingButton.style.setProperty("color", "white", "important");
    existingButton.style.setProperty("padding", "10px", "important");
    existingButton.style.setProperty("border-radius", "50px", "important");
    existingButton.style.setProperty("z-index", "999999", "important");
    existingButton.style.setProperty(
      "font-family",
      "Arial, sans-serif",
      "important",
    );
    existingButton.style.setProperty("font-size", "14px", "important");
    existingButton.style.setProperty("line-height", "1", "important");
    existingButton.style.setProperty("white-space", "nowrap", "important");
    existingButton.style.setProperty("user-select", "none", "important");
    return;
  }

  const button = document.createElement("div");
  button.id = "rito-button";
  button.textContent = "Rito";
  button.style.setProperty("position", "fixed", "important");
  button.style.setProperty("bottom", "20px", "important");
  button.style.setProperty("right", "20px", "important");
  button.style.setProperty("background", "black", "important");
  button.style.setProperty("color", "white", "important");
  button.style.setProperty("padding", "10px", "important");
  button.style.setProperty("border-radius", "50px", "important");
  button.style.setProperty("z-index", "999999", "important");
  button.style.setProperty("font-family", "Arial, sans-serif", "important");
  button.style.setProperty("font-size", "14px", "important");
  button.style.setProperty("line-height", "1", "important");
  button.style.setProperty("white-space", "nowrap", "important");
  button.style.setProperty("user-select", "none", "important");

  if (document.body) {
    document.body.appendChild(button);
  }
}

createRitoUI();
document.addEventListener("DOMContentLoaded", createRitoUI);

function findYoutubeVideoElement() {
  return document.querySelector("video");
}

function clickYoutubeControl(selectors) {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      element.click();
      return true;
    }
  }
  return false;
}

function getVisibleYoutubeVideoLinks() {
  const candidates = Array.from(
    document.querySelectorAll(
      "a#video-title, ytd-rich-item-renderer a#video-title",
    ),
  );

  return candidates.filter((link) => {
    const rect = link.getBoundingClientRect();
    const hasSize = rect.width > 0 && rect.height > 0;
    const inViewport = rect.bottom > 0 && rect.top < window.innerHeight;
    return hasSize && inViewport;
  });
}

function openFirstVisibleYoutubeVideo() {
  const visibleLinks = getVisibleYoutubeVideoLinks();
  const firstVideo = visibleLinks[0];
  if (firstVideo) {
    firstVideo.click();
    console.log("Opened first visible YouTube video.");
    return true;
  }

  const fallback = document.querySelector(
    "ytd-video-renderer a#video-title, a#video-title",
  );
  if (fallback) {
    fallback.click();
    console.log("Opened first fallback YouTube video.");
    return true;
  }

  console.log("No YouTube video link found to open.");
  return false;
}

function openMatchingVisibleYoutubeVideo(query) {
  const normalizedQuery = String(query || "")
    .toLowerCase()
    .trim();
  if (!normalizedQuery) {
    return openFirstVisibleYoutubeVideo();
  }

  const visibleLinks = getVisibleYoutubeVideoLinks();
  const match = visibleLinks.find((link) =>
    String(link.textContent || "")
      .toLowerCase()
      .includes(normalizedQuery),
  );

  if (match) {
    match.click();
    console.log("Opened visible YouTube match:", query);
    return true;
  }

  console.log("No visible YouTube match found for:", query);
  return false;
}

function openVisibleYoutubeVideoByNumber(videoNumber) {
  const number = Number(videoNumber);
  if (!Number.isInteger(number) || number <= 0) {
    console.log("Invalid video number:", videoNumber);
    return false;
  }

  const visibleLinks = getVisibleYoutubeVideoLinks();
  const index = number - 1;
  const target = visibleLinks[index];

  if (target) {
    target.click();
    console.log("Opened visible YouTube video number:", number);
    return true;
  }

  console.log(
    `Video number ${number} is not visible. Visible count: ${visibleLinks.length}`,
  );
  return false;
}

function handleYoutubeAction(message) {
  const action = message?.action;
  const query = message?.query || "";
  const videoNumber = message?.videoNumber;

  if (!/youtube\.com/i.test(location.hostname)) {
    console.log("YouTube action ignored: not on YouTube.");
    return;
  }

  const video = findYoutubeVideoElement();

  if (action === "youtube-play") {
    if (video) {
      video.play().catch(() => {
        // Ignore autoplay restrictions; button fallback below.
      });
      console.log("Attempted to play video element.");
      return;
    }

    const clicked = clickYoutubeControl([
      ".ytp-play-button",
      "button[title='Play (k)']",
      "button[aria-label*='Play']",
    ]);
    if (!clicked) {
      openFirstVisibleYoutubeVideo();
    }
    return;
  }

  if (action === "youtube-pause") {
    if (video) {
      video.pause();
      console.log("Paused video element.");
      return;
    }

    clickYoutubeControl([
      ".ytp-play-button",
      "button[title='Pause (k)']",
      "button[aria-label*='Pause']",
    ]);
    return;
  }

  if (action === "youtube-next") {
    const clicked = clickYoutubeControl([
      ".ytp-next-button",
      "button[aria-keyshortcuts='SHIFT+n']",
      "a.ytp-next-button",
    ]);
    if (!clicked && video) {
      video.currentTime = Math.max(video.duration - 0.25, video.currentTime);
    }
    return;
  }

  if (action === "youtube-previous") {
    const clicked = clickYoutubeControl([
      ".ytp-prev-button",
      "button[aria-keyshortcuts='SHIFT+p']",
      "a.ytp-prev-button",
    ]);
    if (!clicked && video) {
      video.currentTime = 0;
    }
    return;
  }

  if (action === "youtube-mute" || action === "youtube-unmute") {
    if (video) {
      video.muted = action === "youtube-mute";
    }

    clickYoutubeControl([
      ".ytp-mute-button",
      "button[aria-label*='Mute']",
      "button[aria-label*='Unmute']",
    ]);
    return;
  }

  if (action === "youtube-open-first-result") {
    openFirstVisibleYoutubeVideo();
    return;
  }

  if (action === "youtube-open-first-visible") {
    openFirstVisibleYoutubeVideo();
    return;
  }

  if (action === "youtube-open-visible-match") {
    const opened = openMatchingVisibleYoutubeVideo(query);
    if (!opened) {
      openFirstVisibleYoutubeVideo();
    }
    return;
  }

  if (action === "youtube-open-visible-number") {
    const opened = openVisibleYoutubeVideoByNumber(videoNumber);
    if (!opened) {
      openFirstVisibleYoutubeVideo();
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Content script received message:", message);

  if (String(message.action || "").startsWith("youtube-")) {
    handleYoutubeAction(message);
    return;
  }

  if (message.action === "getPageData") {
    const links = Array.from(document.querySelectorAll("a")).map((link) => ({
      text: (link.textContent || "").trim(),
      url: link.href,
    }));

    const headings = Array.from(document.querySelectorAll("h1, h2, h3"))
      .map((heading) => (heading.textContent || "").trim())
      .filter(Boolean);

    const paragraphs = Array.from(document.querySelectorAll("p"))
      .slice(0, 10)
      .map((paragraph) => (paragraph.textContent || "").trim())
      .filter(Boolean);

    console.log("Collected page data:", {
      title: document.title,
      linksCount: links.length,
      headingsCount: headings.length,
      paragraphsCount: paragraphs.length,
    });

    sendResponse({
      title: document.title,
      links,
      headings,
      paragraphs,
    });
    return;
  }

  if (message.action === "type") {
    const input = document.querySelector("input, textarea");

    if (!input) {
      console.log("No input or textarea found.");
      return;
    }

    input.focus();
    input.value = message.text || "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    const enterEventInit = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };

    input.dispatchEvent(new KeyboardEvent("keydown", enterEventInit));
    input.dispatchEvent(new KeyboardEvent("keypress", enterEventInit));
    input.dispatchEvent(new KeyboardEvent("keyup", enterEventInit));

    const form = input.closest("form");
    if (form) {
      form.requestSubmit();
      console.log("Submitted closest form after Enter simulation.");
    }

    console.log("Typed text into input:", message.text || "");
    console.log("Simulated Enter key sequence.");
    return;
  }

  if (message.action === "click") {
    const clickableElements = document.querySelectorAll(
      "button, a, [role='button'], input[type='button'], input[type='submit']",
    );
    const targetText = (message.text || "").toLowerCase().trim();

    if (!targetText) {
      console.log("No target text provided for click action.");
      return;
    }

    for (const element of clickableElements) {
      const elementText = (element.textContent || element.value || "")
        .toLowerCase()
        .trim();

      if (elementText.includes(targetText)) {
        element.click();
        console.log("Clicked element matching text:", message.text);
        return;
      }
    }

    console.log("No clickable element found for text:", message.text);
  }
});
