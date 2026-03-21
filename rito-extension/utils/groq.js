const RITO_GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const RITO_SYSTEM_PROMPT = `You are Rito, a voice-controlled browser assistant. The user will give you a
voice command and a summary of the current web page. You must respond with ONLY
a valid JSON object — no markdown, no explanation, just raw JSON.

JSON schema:
{
  "action": "click" | "navigate" | "fill" | "scroll" | "read" | "search" | "none",
  "selector": "CSS selector string or null",
  "value": "text to type or URL to navigate to or null",
  "target": "human-readable description of what you are acting on",
  "response": "short spoken confirmation to read back to the user (max 15 words)"
}

Rules:
- For "click": provide a CSS selector for the element to click
- For "navigate": put the full URL in "value"
- For "fill": provide selector AND value (the text to type)
- For "scroll": value is "up", "down", "top", or "bottom"
- For "read": summarize the main content of the page in the "response" field
- For "search": value is the search query, selector is the search input selector
- For "none": when the command cannot be executed, explain why in "response"
- Prefer data-testid, aria-label, name, id, or role selectors over nth-child
- Keep "response" natural and conversational`;

/**
 * Rito Groq client that maps voice commands to executable browser actions.
 * @param {string} ritoTranscript Voice command transcript from Rito speech input.
 * @param {{url:string,title:string,headings:string[],links:Array<{text:string,href:string}>,buttons:string[],inputs:Array<{type:string,name:string,placeholder:string}>}} ritoPageContext Context snapshot from the active page.
 * @returns {Promise<{action:string,selector?:string|null,value?:string|null,target?:string,response:string}>}
 */
export async function ritoGetGroqAction(ritoTranscript, ritoPageContext) {
  try {
    const { ritoGroqApiKey } = await chrome.storage.local.get({
      ritoGroqApiKey: "",
    });

    if (!ritoGroqApiKey) {
      return {
        action: "none",
        selector: null,
        value: null,
        target: "API key",
        response: "Invalid API key. Please update it in Rito settings.",
      };
    }

    const ritoUserPrompt = `Voice command: "${ritoTranscript}"

Page context:
- URL: ${ritoPageContext.url}
- Title: ${ritoPageContext.title}
- Headings: ${JSON.stringify(ritoPageContext.headings)}
- Links: ${JSON.stringify(ritoPageContext.links)}
- Buttons: ${JSON.stringify(ritoPageContext.buttons)}
- Inputs: ${JSON.stringify(ritoPageContext.inputs)}`;

    const ritoResponse = await fetch(RITO_GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ritoGroqApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        temperature: 0,
        max_tokens: 200,
        messages: [
          { role: "system", content: RITO_SYSTEM_PROMPT },
          { role: "user", content: ritoUserPrompt },
        ],
      }),
    });

    if (!ritoResponse.ok) {
      if (ritoResponse.status === 429) {
        return {
          action: "none",
          selector: null,
          value: null,
          target: "Rate limit",
          response: "Rito hit the rate limit. Please wait a moment.",
        };
      }

      if (ritoResponse.status === 401) {
        return {
          action: "none",
          selector: null,
          value: null,
          target: "API key",
          response: "Invalid API key. Please update it in Rito settings.",
        };
      }

      console.log(
        "[Rito] Groq request failed with status",
        ritoResponse.status,
      );
      return {
        action: "none",
        selector: null,
        value: null,
        target: "API",
        response: "Rito could not process that command. Please try again.",
      };
    }

    const ritoPayload = await ritoResponse.json();
    const ritoRaw = ritoPayload?.choices?.[0]?.message?.content || "";

    try {
      return JSON.parse(ritoRaw);
    } catch {
      const ritoJsonMatch = ritoRaw.match(/\{[\s\S]*\}/);
      if (ritoJsonMatch) {
        return JSON.parse(ritoJsonMatch[0]);
      }
      console.log("[Rito] Groq raw response parse failure:", ritoRaw);
      return {
        action: "none",
        selector: null,
        value: null,
        target: "Parser",
        response: "Rito could not process that command. Please try again.",
      };
    }
  } catch (ritoError) {
    console.log("[Rito] Groq error:", ritoError);
    return {
      action: "none",
      selector: null,
      value: null,
      target: "Network",
      response: "Rito could not process that command. Please try again.",
    };
  }
}
