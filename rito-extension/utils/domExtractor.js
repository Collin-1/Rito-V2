/**
 * Rito DOM extractor for lightweight page context used by voice planning.
 * Keeps payloads compact for token-efficient Groq requests.
 * @returns {{url:string,title:string,headings:string[],links:Array<{text:string,href:string}>,buttons:string[],inputs:Array<{type:string,name:string,placeholder:string}>}}
 */
export function ritoExtractPageContext() {
  const ritoContext = {
    url: window.location.href,
    title: document.title,
    headings: Array.from(document.querySelectorAll("h1,h2,h3"))
      .slice(0, 8)
      .map((ritoHeading) => ritoHeading.innerText.trim())
      .filter(Boolean),
    links: Array.from(document.querySelectorAll("a[href]"))
      .slice(0, 15)
      .map((ritoAnchor) => ({
        text: ritoAnchor.innerText.trim(),
        href: ritoAnchor.href,
      }))
      .filter((ritoLink) => ritoLink.text.length > 0),
    buttons: Array.from(
      document.querySelectorAll(
        'button, [role="button"], input[type="submit"]',
      ),
    )
      .slice(0, 10)
      .map(
        (ritoButton) =>
          ritoButton.innerText.trim() ||
          ritoButton.value ||
          ritoButton.getAttribute("aria-label"),
      )
      .filter(Boolean),
    inputs: Array.from(
      document.querySelectorAll('input:not([type="hidden"]), textarea, select'),
    )
      .slice(0, 8)
      .map((ritoInput) => ({
        type: ritoInput.type || ritoInput.tagName.toLowerCase(),
        name:
          ritoInput.name ||
          ritoInput.id ||
          ritoInput.getAttribute("aria-label") ||
          "",
        placeholder: ritoInput.placeholder || "",
      })),
  };

  return ritoClampContextSize(ritoContext, 1500);
}

/**
 * Rito context clamp to keep serialized data under token budget.
 * @param {ReturnType<typeof ritoExtractPageContext>} ritoContext Context object to trim.
 * @param {number} ritoMaxChars Maximum JSON character count.
 * @returns {ReturnType<typeof ritoExtractPageContext>}
 */
function ritoClampContextSize(ritoContext, ritoMaxChars) {
  const ritoTrimmed = {
    ...ritoContext,
    headings: [...ritoContext.headings],
    links: [...ritoContext.links],
    buttons: [...ritoContext.buttons],
    inputs: [...ritoContext.inputs],
  };

  const ritoArrayOrder = ["links", "buttons", "headings", "inputs"];
  let ritoIndex = 0;

  while (
    JSON.stringify(ritoTrimmed).length > ritoMaxChars &&
    ritoIndex < 1000
  ) {
    const ritoKey = ritoArrayOrder[ritoIndex % ritoArrayOrder.length];
    if (ritoTrimmed[ritoKey].length > 0) {
      ritoTrimmed[ritoKey].pop();
    }
    ritoIndex += 1;
  }

  return ritoTrimmed;
}
