# Rito — Voice Browser Assistant

Rito means 'voice' in Tsonga, a Bantu language spoken in southern Africa.

Rito is a Chrome Extension (Manifest V3) that listens to voice commands, sends the transcript with lightweight page context to Groq (Llama 3.1 8B), and executes actions like click, navigate, fill, scroll, search, or read.

## Project Layout

- `rito-extension/manifest.json` - Extension manifest and permissions
- `rito-extension/background.js` - Service worker orchestration pipeline
- `rito-extension/content.js` - Page action executor and context bridge
- `rito-extension/offscreen/` - Speech recognition offscreen document
- `rito-extension/popup/` - Rito popup UI and controls
- `rito-extension/utils/` - Groq client, DOM extractor, and TTS helper

## Quick Start

1. Open Chrome and go to `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked and select `rito-extension`.
4. Open the Rito popup and save your Groq API key.
5. Click Start listening or use Alt+Shift+R.
