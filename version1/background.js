const GROQ_API_KEY = "Your api key";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isSupportedTabUrl(url) {
  return /^https?:\/\//i.test(url || "");
}

async function getCurrentWindowTabs() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs.sort((a, b) => (a.index || 0) - (b.index || 0));
}

function parseTabNavigationCommand(command) {
  const lower = String(command || "")
    .toLowerCase()
    .trim();
  const numberWords = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
  };

  if (!lower) {
    return null;
  }

  if (
    /(^|\s)(next tab|switch to (?:the )?next tab|go to (?:the )?next tab)(\s|$)/.test(
      lower,
    )
  ) {
    return { action: "tab-next" };
  }

  if (
    /(^|\s)(previous tab|prev tab|last tab|switch to (?:the )?previous tab|go to (?:the )?previous tab)(\s|$)/.test(
      lower,
    )
  ) {
    return { action: "tab-previous" };
  }

  if (/(^|\s)(close tab|close this tab)(\s|$)/.test(lower)) {
    return { action: "tab-close" };
  }

  if (/(^|\s)(new tab|open new tab|create new tab)(\s|$)/.test(lower)) {
    return { action: "tab-new" };
  }

  const numberMatch = lower.match(
    /(?:switch to|go to|open)\s+(?:the\s+)?tab\s+([a-z0-9]+)|tab\s+([a-z0-9]+)/,
  );
  const rawTabNumber = (numberMatch?.[1] || numberMatch?.[2] || "").trim();
  const parsedNumber = Number(rawTabNumber);
  const parsedFromWord = numberWords[rawTabNumber];
  const finalTabNumber = Number.isInteger(parsedNumber)
    ? parsedNumber
    : parsedFromWord;
  if (Number.isInteger(finalTabNumber) && finalTabNumber > 0) {
    return { action: "tab-number", tabNumber: finalTabNumber };
  }

  const titleMatch = lower.match(/(?:switch to|go to|open)\s+(.+?)\s+tab$/);
  if (titleMatch?.[1]) {
    return { action: "tab-title", titleQuery: titleMatch[1].trim() };
  }

  return null;
}

async function executeTabNavigation(tabCommand) {
  if (!tabCommand?.action) {
    return null;
  }

  if (tabCommand.action === "tab-new") {
    await chrome.tabs.create({});
    return "Opened a new tab.";
  }

  const tabs = await getCurrentWindowTabs();
  if (tabs.length === 0) {
    throw new Error("No tabs found in the current window.");
  }

  const activeIndex = tabs.findIndex((tab) => tab.active);
  if (activeIndex === -1) {
    throw new Error("No active tab found.");
  }

  if (tabCommand.action === "tab-next") {
    const next = tabs[(activeIndex + 1) % tabs.length];
    await chrome.tabs.update(next.id, { active: true });
    return `Switched to next tab: ${next.title || next.url || "Untitled"}`;
  }

  if (tabCommand.action === "tab-previous") {
    const prev = tabs[(activeIndex - 1 + tabs.length) % tabs.length];
    await chrome.tabs.update(prev.id, { active: true });
    return `Switched to previous tab: ${prev.title || prev.url || "Untitled"}`;
  }

  if (tabCommand.action === "tab-number") {
    const targetIndex = tabCommand.tabNumber - 1;
    const target = tabs[targetIndex];
    if (!target) {
      throw new Error(`Tab ${tabCommand.tabNumber} does not exist.`);
    }
    await chrome.tabs.update(target.id, { active: true });
    return `Switched to tab ${tabCommand.tabNumber}: ${target.title || target.url || "Untitled"}`;
  }

  if (tabCommand.action === "tab-title") {
    const query = tabCommand.titleQuery;
    const target = tabs.find((tab) => {
      const title = String(tab.title || "").toLowerCase();
      const url = String(tab.url || "").toLowerCase();
      return title.includes(query) || url.includes(query);
    });

    if (!target) {
      throw new Error(`No tab matched \"${query}\".`);
    }

    await chrome.tabs.update(target.id, { active: true });
    return `Switched to tab: ${target.title || target.url || "Untitled"}`;
  }

  if (tabCommand.action === "tab-close") {
    const activeTab = tabs[activeIndex];
    await chrome.tabs.remove(activeTab.id);
    return "Closed the active tab.";
  }

  return null;
}

function waitForTabComplete(tabId, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error("Timed out waiting for tab to finish loading."));
    }, timeoutMs);

    function onUpdated(updatedTabId, changeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") {
        return;
      }

      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function sendMessageToTabWithRetry(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    const message = String(error?.message || "");
    const needsInjection = message.includes("Receiving end does not exist");

    if (!needsInjection) {
      throw error;
    }

    console.log("Content script not ready. Injecting content.js and retrying.");
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });

    return await chrome.tabs.sendMessage(tabId, payload);
  }
}

function isWebsiteQuestionCommand(command) {
  const lower = command.toLowerCase();
  return (
    lower.includes("current website") ||
    lower.includes("this site") ||
    lower.includes("find") ||
    lower.includes("where can i")
  );
}

function isWebsiteSummaryCommand(command) {
  const lower = command.toLowerCase();
  return (
    lower.includes("tell me about") ||
    lower.includes("summarize") ||
    lower.includes("what is this site")
  );
}

function parseModelJson(content) {
  const trimmed = String(content || "").trim();

  if (!trimmed) {
    throw new Error("Empty model response.");
  }

  const candidates = [];
  candidates.push(trimmed);

  const fencedWholeMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fencedWholeMatch?.[1]) {
    candidates.push(fencedWholeMatch[1].trim());
  }

  const fencedAnyMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fencedAnyMatch?.[1]) {
    candidates.push(fencedAnyMatch[1].trim());
  }

  const firstArrayStart = trimmed.indexOf("[");
  const lastArrayEnd = trimmed.lastIndexOf("]");
  if (firstArrayStart !== -1 && lastArrayEnd > firstArrayStart) {
    candidates.push(trimmed.slice(firstArrayStart, lastArrayEnd + 1).trim());
  }

  const firstObjectStart = trimmed.indexOf("{");
  const lastObjectEnd = trimmed.lastIndexOf("}");
  if (firstObjectStart !== -1 && lastObjectEnd > firstObjectStart) {
    candidates.push(trimmed.slice(firstObjectStart, lastObjectEnd + 1).trim());
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try next candidate.
    }
  }

  throw new Error("Model response did not contain valid JSON.");
}

async function interpretWebsiteDataWithGroq(command, pageData) {
  const linksJson = JSON.stringify(pageData?.links || [], null, 2);
  const title = pageData?.title || "";
  const websitePrompt = `You are analyzing a website. Here are the links:\nTitle: ${title}\n${linksJson}\n\nUser question:\n${command}\n\nReturn ONLY the best matching URL as JSON:\n{ "action": "open", "url": "..." }`;

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: websitePrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Groq website response missing message content.");
  }

  return parseModelJson(content);
}

async function summarizeWebsiteWithGroq(pageData) {
  const title = pageData?.title || "";
  const headings = JSON.stringify(pageData?.headings || [], null, 2);
  const paragraphs = JSON.stringify(pageData?.paragraphs || [], null, 2);
  const summaryPrompt = `You are analyzing a website.

Title:
${title}

Headings:
${headings}

Content:
${paragraphs}

Give a short, clear summary of what this website is about.`;

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "user",
          content: summaryPrompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Groq summary response missing message content.");
  }

  return String(content).trim();
}

async function interpretCommandWithGroq(command) {
  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GROQ_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            'You are an assistant that converts user commands into JSON actions. Always return a JSON array. No explanations. Only valid JSON. Format: [{"action":"open","url":"..."},{"action":"type","text":"..."},{"action":"click","text":"..."}]. Examples: User: "open youtube" -> [{"action":"open","url":"https://youtube.com"}]. User: "search calculus on youtube" -> [{"action":"open","url":"https://youtube.com"},{"action":"type","text":"calculus"}].',
        },
        {
          role: "user",
          content: command,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  const content = data?.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Groq response missing message content.");
  }

  const parsed = parseModelJson(content);

  if (!Array.isArray(parsed)) {
    throw new Error("Groq response is not a JSON array of actions.");
  }

  return parsed;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      const command = (message.command || "").trim();
      console.log("Background received command:", command);

      if (!command) {
        sendResponse({ status: "No command provided." });
        return;
      }

      const tabCommand = parseTabNavigationCommand(command);
      if (tabCommand) {
        const tabStatus = await executeTabNavigation(tabCommand);
        sendResponse({ status: tabStatus || "Tab action completed." });
        return;
      }

      if (GROQ_API_KEY === "YOUR_API_KEY") {
        throw new Error("Set GROQ_API_KEY in background.js before using Groq.");
      }

      if (isWebsiteSummaryCommand(command)) {
        console.log("Detected website-summary command.");

        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const activeTab = tabs[0];

        if (!activeTab?.id) {
          throw new Error("No active tab found.");
        }

        if (!isSupportedTabUrl(activeTab.url)) {
          throw new Error(
            "This page does not allow automation. Open a regular website tab and try again.",
          );
        }

        const pageData = await sendMessageToTabWithRetry(activeTab.id, {
          action: "getPageData",
        });
        console.log("Received page data for summary:", {
          title: pageData?.title || "",
          linksCount: pageData?.links?.length || 0,
          headingsCount: pageData?.headings?.length || 0,
          paragraphsCount: pageData?.paragraphs?.length || 0,
        });

        const summary = await summarizeWebsiteWithGroq(pageData);
        console.log("Website summary:", summary);

        sendResponse({
          status: "Summary generated.",
          result: summary,
        });
        return;
      }

      if (isWebsiteQuestionCommand(command)) {
        console.log("Detected website-analysis command.");

        const tabs = await chrome.tabs.query({
          active: true,
          currentWindow: true,
        });
        const activeTab = tabs[0];

        if (!activeTab?.id) {
          throw new Error("No active tab found.");
        }

        if (!isSupportedTabUrl(activeTab.url)) {
          throw new Error(
            "This page does not allow automation. Open a regular website tab and try again.",
          );
        }

        const pageData = await sendMessageToTabWithRetry(activeTab.id, {
          action: "getPageData",
        });
        console.log("Received page data for analysis:", {
          title: pageData?.title || "",
          linksCount: pageData?.links?.length || 0,
        });

        const bestMatchAction = await interpretWebsiteDataWithGroq(
          command,
          pageData,
        );
        console.log("Groq best-match action:", bestMatchAction);

        if (bestMatchAction?.action === "open" && bestMatchAction.url) {
          await chrome.tabs.create({ url: bestMatchAction.url });
          sendResponse({ status: `Opened: ${bestMatchAction.url}` });
          return;
        }

        sendResponse({ status: "No matching URL found." });
        return;
      }

      const actions = await interpretCommandWithGroq(command);
      console.log("Groq actions:", actions);

      if (actions.length === 0) {
        sendResponse({ status: "No actions returned." });
        return;
      }

      let targetTabId = null;
      let targetTabUrl = null;

      for (const step of actions) {
        console.log("Executing step:", step);

        if (step?.action === "open" && step.url) {
          const openedTab = await chrome.tabs.create({ url: step.url });
          targetTabId = openedTab.id;
          targetTabUrl = openedTab.url || step.url;
          if (targetTabId) {
            await waitForTabComplete(targetTabId);
            const refreshedTab = await chrome.tabs.get(targetTabId);
            targetTabUrl = refreshedTab.url || targetTabUrl;
          }
          console.log("Opened URL:", step.url);
          continue;
        }

        if (
          (step?.action === "type" || step?.action === "click") &&
          step.text
        ) {
          console.log("Waiting 2 seconds before:", step.action);
          await delay(2000);

          if (!targetTabId) {
            const tabs = await chrome.tabs.query({
              active: true,
              currentWindow: true,
            });
            const activeTab = tabs[0];
            targetTabId = activeTab?.id || null;
            targetTabUrl = activeTab?.url || null;
          }

          if (!targetTabId) {
            throw new Error("No active tab found.");
          }

          if (!isSupportedTabUrl(targetTabUrl)) {
            throw new Error(
              "This page does not allow automation. Open a regular website tab and try again.",
            );
          }

          await sendMessageToTabWithRetry(targetTabId, {
            action: step.action,
            text: step.text,
          });

          console.log("Executed action on tab:", step.action);
          continue;
        }

        console.log("Skipped unsupported step:", step);
      }

      sendResponse({ status: `Executed ${actions.length} action(s).` });
    } catch (error) {
      console.error("Failed to process command:", error);
      sendResponse({ status: `Error: ${error.message}` });
    }
  })();

  return true;
});
