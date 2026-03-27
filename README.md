# Rito Assistant Chrome Extension (Manifest V3)

Rito Assistant is a Chrome extension that lets you control browser actions with text or voice commands.

It can:

- Open websites
- Type text into page inputs
- Click page buttons/links by text
- Analyze a website's links/content to find relevant pages
- Summarize the current website

It uses:

- Chrome Extension APIs (popup, background service worker, content scripts, tabs, messaging)
- Groq API for command interpretation and website understanding
- Web Speech API (`webkitSpeechRecognition`) for voice input in the popup

---

## Project Structure

- `manifest.json`
- `popup.html`
- `popup.js`
- `background.js`
- `content.js`

### What each file does

## `manifest.json`

Defines the extension configuration:

- Manifest version 3
- Extension name/version/description
- Permissions (`activeTab`, `scripting`)
- Host permissions (Groq endpoint)
- Popup entry (`popup.html`)
- Background service worker (`background.js`)
- Content script registration (`content.js`) on all URLs

## `popup.html`

The extension UI shown when clicking the extension icon.
Contains:

- Text input for commands
- `Run` button
- `🎤 Speak` button
- Status text areas
- Result area where AI output appears

## `popup.js`

Controls popup behavior:

- Reads command from input
- Sends command to background via `chrome.runtime.sendMessage`
- Displays status and result text
- Starts voice recognition when `Speak` is clicked
- On speech result:
  - fills the input with recognized text
  - auto-triggers command execution

## `background.js`

Main orchestration logic:

- Receives command messages from popup
- Decides command route:
  - direct action planning (open/type/click arrays)
  - website link lookup route (find URLs on current site)
  - website summary route
- Calls Groq API
- Parses AI responses (including fenced JSON)
- Executes actions in sequence
- Communicates with content script for on-page actions

## `content.js`

Runs inside web pages and manipulates page DOM:

- `getPageData`
  - returns title, links, headings, paragraphs
- `type`
  - finds input/textarea
  - inserts text
  - dispatches input/change and Enter key events
  - submits nearest form when present
- `click`
  - finds clickable elements and clicks best text match

---

## End-to-End Flow

## 1) Text command flow

1. User enters command in popup and clicks `Run`.
2. `popup.js` sends `{ command }` to `background.js`.
3. `background.js` analyzes command type and calls Groq.
4. Groq returns actions.
5. `background.js` executes each step:
   - `open` -> `chrome.tabs.create`
   - `type/click` -> sends message to `content.js`
6. Popup displays status/result.

## 2) Voice command flow

1. User clicks `🎤 Speak`.
2. `popup.js` starts speech recognition.
3. Recognized transcript is inserted into input.
4. Same run flow as text command is triggered automatically.

## 3) Website "find" flow

Triggered when command includes phrases like:

- `current website`
- `this site`
- `find`
- `where can I`

Steps:

1. `background.js` requests `getPageData` from active tab.
2. `content.js` returns links + page metadata.
3. Background prompts Groq to choose best matching URL.
4. If valid, background opens the returned URL.

## 4) Website summary flow

Triggered when command includes phrases like:

- `tell me about`
- `summarize`
- `what is this site`

Steps:

1. Background gets page data from content script.
2. Sends title/headings/paragraphs to Groq.
3. Receives short summary text.
4. Returns summary to popup and displays it.

---

## AI Output Contracts

## Action planning (general commands)

Expected JSON array:

```json
[
  { "action": "open", "url": "https://example.com" },
  { "action": "type", "text": "query" },
  { "action": "click", "text": "search" }
]
```

## Site link matching

Expected JSON object:

```json
{ "action": "open", "url": "https://example.com/page" }
```

The background parser is resilient to fenced output like:

- `json ... `
- plain JSON

---

## Messaging Model

- Popup -> Background:
  - `chrome.runtime.sendMessage({ command })`

- Background -> Content:
  - `chrome.tabs.sendMessage(tabId, { action, ... })`

- Content -> Background (response):
  - `sendResponse({ ...pageData })`

If content script is missing in the tab, background retries after injecting `content.js` via `chrome.scripting.executeScript`.

---

## Setup and Run

## 1) Add Groq API key

In `background.js`, set:

- `GROQ_API_KEY`

## 2) Load extension

1. Open Chrome -> `chrome://extensions`
2. Enable Developer mode
3. Click `Load unpacked`
4. Select this project folder

## 3) Test commands

Examples:

- `open youtube`
- `search calculus on youtube`
- `find investments on current website`
- `tell me about this site`

---

## Permissions and Browser Notes

- Uses `activeTab` and `scripting`
- Uses host permission for Groq API endpoint
- Voice uses `webkitSpeechRecognition` (Chrome-specific)
- Some pages cannot be automated (for example `chrome://` pages)

---

## Common Troubleshooting

## "Receiving end does not exist"

Cause:

- Content script not loaded in the tab yet

Handled by app:

- Background auto-injects `content.js` and retries

## JSON parse errors from model output

Cause:

- Model sometimes wraps JSON in code fences

Handled by app:

- Background strips code fences before parsing

## Speech error: `not-allowed` / `Permission dismissed`

Possible causes:

- Mic permission blocked
- Prompt dismissed
- Browser-level mic disabled

Fix:

1. Re-open popup and try Speak again
2. Ensure Chrome microphone access is allowed
3. Check OS-level microphone permission for Chrome

---

## Security Notes

Current implementation keeps API key in `background.js` for local development convenience.
For demos or sharing:

- Do not commit real API keys
- Rotate any exposed key immediately
- Consider using a backend proxy for production

---

## Demo Script (Quick)

Use this sequence when presenting:

1. `open youtube`
2. `search calculus on youtube`
3. On a finance site: `find investments on current website`
4. On any content site: `summarize this site`
5. Click `Speak` and say `tell me about this site`

This demonstrates navigation, on-page automation, contextual site understanding, and voice input.
