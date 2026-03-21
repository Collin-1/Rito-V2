let ritoDomExtractorModulePromise = null;

/**
 * Rito helper to lazy-load DOM extraction utilities from extension resources.
 * @returns {Promise<typeof import('./utils/domExtractor.js')>}
 */
async function ritoGetDomExtractorModule() {
  if (!ritoDomExtractorModulePromise) {
    ritoDomExtractorModulePromise = import(
      chrome.runtime.getURL("utils/domExtractor.js")
    );
  }
  return ritoDomExtractorModulePromise;
}

/**
 * Rito helper to find a clickable element by visible text fallback.
 * @param {string} ritoTarget Human-readable target description.
 * @returns {HTMLElement|null}
 */
function ritoFindElementByText(ritoTarget) {
  if (!ritoTarget) {
    return null;
  }

  const ritoNeedle = ritoTarget.trim().toLowerCase();
  if (!ritoNeedle) {
    return null;
  }

  const ritoCandidates = Array.from(
    document.querySelectorAll(
      'button, a, [role="button"], input[type="submit"]',
    ),
  );
  for (const ritoCandidate of ritoCandidates) {
    const ritoText = (
      ritoCandidate.innerText ||
      ritoCandidate.value ||
      ritoCandidate.getAttribute("aria-label") ||
      ""
    )
      .trim()
      .toLowerCase();

    if (
      ritoText &&
      (ritoText === ritoNeedle || ritoText.includes(ritoNeedle))
    ) {
      return /** @type {HTMLElement} */ (ritoCandidate);
    }
  }

  return null;
}

/**
 * Rito helper to dispatch form input events after value changes.
 * @param {HTMLElement} ritoElement Input-like element.
 * @returns {void}
 */
function ritoDispatchInputEvents(ritoElement) {
  ritoElement.dispatchEvent(new Event("input", { bubbles: true }));
  ritoElement.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Rito action executor for commands planned by Groq.
 * @param {{action:string,selector?:string|null,value?:string|null,target?:string,response?:string}} ritoAction Action object.
 * @returns {Promise<string>}
 */
async function ritoExecuteAction(ritoAction) {
  const ritoType = ritoAction?.action || "none";
  const ritoSelector = ritoAction?.selector || null;
  const ritoValue = ritoAction?.value || null;
  const ritoTarget = ritoAction?.target || "target";

  try {
    switch (ritoType) {
      case "click": {
        let ritoElement = ritoSelector
          ? document.querySelector(ritoSelector)
          : null;
        if (!ritoElement) {
          ritoElement = ritoFindElementByText(ritoTarget);
        }

        if (!ritoElement) {
          return `Could not find ${ritoTarget}`;
        }

        ritoElement.focus();
        ritoElement.click();
        return `Clicked ${ritoTarget}`;
      }

      case "navigate": {
        if (!ritoValue) {
          return "No URL provided for navigation";
        }
        window.location.href = ritoValue;
        return `Navigating to ${ritoValue}`;
      }

      case "fill": {
        if (!ritoSelector) {
          return "No selector provided for fill action";
        }
        const ritoInput = document.querySelector(ritoSelector);
        if (!ritoInput) {
          return `Could not find ${ritoTarget}`;
        }

        ritoInput.focus();
        ritoInput.value = ritoValue || "";
        ritoDispatchInputEvents(ritoInput);
        return `Filled ${ritoTarget} with ${ritoValue || ""}`;
      }

      case "scroll": {
        if (ritoValue === "up") {
          window.scrollBy(0, -400);
        } else if (ritoValue === "down") {
          window.scrollBy(0, 400);
        } else if (ritoValue === "top") {
          window.scrollTo(0, 0);
        } else if (ritoValue === "bottom") {
          window.scrollTo(0, document.body.scrollHeight);
        }
        return `Scrolled ${ritoValue}`;
      }

      case "read":
        return ritoAction?.response || "Rito read the main content.";

      case "search": {
        if (!ritoSelector) {
          return "No selector provided for search action";
        }

        const ritoSearchInput = document.querySelector(ritoSelector);
        if (!ritoSearchInput) {
          return `Could not find ${ritoTarget}`;
        }

        ritoSearchInput.focus();
        ritoSearchInput.value = ritoValue || "";
        ritoDispatchInputEvents(ritoSearchInput);
        ritoSearchInput.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            code: "Enter",
            bubbles: true,
          }),
        );

        return `Searching for ${ritoValue || ""}`;
      }

      case "none":
      default:
        return ritoAction?.response || "Rito could not process that command.";
    }
  } catch (ritoError) {
    console.log("[Rito] Action execution failed:", ritoError);
    return "Rito could not execute that action.";
  }
}

chrome.runtime.onMessage.addListener(
  (ritoMessage, _ritoSender, ritoSendResponse) => {
    (async () => {
      try {
        if (ritoMessage?.type === "RITO_EXECUTE_ACTION") {
          const ritoResult = await ritoExecuteAction(ritoMessage.action || {});
          ritoSendResponse({ ok: true, result: ritoResult });
          return;
        }

        if (ritoMessage?.type === "RITO_EXTRACT_PAGE_CONTEXT") {
          const { ritoExtractPageContext } = await ritoGetDomExtractorModule();
          const ritoContext = ritoExtractPageContext();
          ritoSendResponse({ ok: true, context: ritoContext });
          return;
        }

        ritoSendResponse({ ok: false, error: "Unsupported Rito message type" });
      } catch (ritoError) {
        console.log("[Rito] Content message handler error:", ritoError);
        ritoSendResponse({ ok: false, error: String(ritoError) });
      }
    })();

    return true;
  },
);
