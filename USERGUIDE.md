# Rito User Guide

Rito lets you control your browser with your voice. You can scroll, click, switch tabs, search, fill in forms and type text, all without touching the mouse or keyboard.

---

## 1. The basics

### Turning Rito on and off

Click the **Rito icon** in your browser toolbar to open the popup.

| Button | What it does |
|---|---|
| **Start / Stop listening** | Turns the microphone on or off |
| **Commands** | Rito follows your spoken commands |
| **Dictation** | Rito types what you say |
| **Show / Hide numbers** | Puts number labels on everything you can click |
| **Settings** | Opens the settings page |

You can also say **"stop listening"** to turn the microphone off.

### How to speak to Rito

1. Speak clearly at a normal pace.
2. **Pause briefly** after each command. Rito acts once you stop talking.
3. Watch the bottom of the page. **"Listening: …"** means Rito hears you. **"Heard: …"** shows what it understood.

> **Tip:** Say one command at a time. "Scroll down" works better than "scroll down and then click the first link".

---

## 2. The two modes

| Mode | Use it when you want to… | Switch to it by saying |
|---|---|---|
| **Commands** (default) | Navigate, click, scroll, manage tabs | "commands mode" or "stop dictation" |
| **Dictation** | Write emails, messages, notes | "start dictation" or "dictation mode" |

---

## 3. Commands mode: what you can say

### Scrolling

| Say | Result |
|---|---|
| "scroll down" / "scroll up" | Scrolls a little |
| "scroll down 3 times" | Scrolls down three screens |
| "scroll down 500" | Scrolls exactly 500 pixels |
| "page down" / "page up" | Scrolls one full screen |

### Clicking things

**Click by name:** say what is written on the button or link.

- "click sign in"
- "click submit" (or just "submit")
- "open menu"
- "hover settings" (moves the mouse over it, useful for drop-down menus)

**Click by number:** use this when a button has no text, or when there are several with the same name.

1. Say **"show numbers"**. A small number appears on every clickable item.
2. Say **"click 5"** (or "click number five", "open the third").
3. Say **"hide numbers"** when you're done.

### Typing into forms

| Say | Result |
|---|---|
| "type hello world" | Types into the box you're currently in |
| "type john@example.com in email" | Finds the email field and fills it in |
| "enter Cape Town in city" | Finds the city field and fills it in |

### Pages and websites

| Say | Result |
|---|---|
| "go to youtube.com" | Opens that website |
| "open wikipedia in new tab" | Opens the website in a new tab |
| "search for weather in Johannesburg" | Searches the web |
| "go back" / "go forward" | Moves back or forward in your history |
| "refresh" | Reloads the page |
| "where is the contact page" | Finds that topic on the current page |
| "summarize this page" | Shows a short summary of the page |

### Tabs and windows

| Say | Result |
|---|---|
| "new tab" | Opens a new tab |
| "close tab" | Closes the current tab |
| "next tab" / "previous tab" | Moves between tabs |
| "go to tab 3" | Jumps to the third tab |
| "switch to Gmail tab" | Jumps to the tab with that name |
| "duplicate tab" | Makes a copy of the current tab |
| "new window" | Opens a new browser window |
| "move tab to new window" | Pops the current tab out into its own window |

---

## 4. Dictation mode: writing with your voice

1. Click into a text box (an email, a search bar, a comment box).
2. Say **"start dictation"**.
3. Speak naturally. Rito types your words and adds punctuation automatically.
4. Say **"stop dictation"** when you're done.

**Editing while you dictate:**

| Say | Result |
|---|---|
| "new line" | Starts a new line |
| "delete last word" | Removes the last word |
| "delete last 3 words" | Removes the last three words |
| "clear all" | Deletes everything you typed |
| "comma", "period", "question mark" | Inserts that punctuation mark |

---

## 5. Wake phrase mode (optional)

By default, Rito acts on everything it hears. If you're in a noisy room, or you talk to other people while browsing, turn on **wake phrase mode** so Rito only listens when you call it.

1. Open **Settings**.
2. Under **Command activation mode**, choose **Wake phrase only**.
3. Click **Save settings**.

Now start each command with **"Hey Rito"**:

- "Hey Rito, scroll down"
- "Hey Rito, close tab"

After you say "Hey Rito", you have a few seconds to give more commands without repeating it.

---

## 6. Useful settings

Open them from the popup with **Settings**. Remember to click **Save settings**.

| Setting | What it's for |
|---|---|
| **Command language** | The language and accent you speak, e.g. English (South Africa) |
| **Speech recognition model** | **Turbo** is fast and right for most people. **Large v3** is a little more accurate but slower |
| **Microphone sensitivity** | Move it **lower** if Rito misses quiet speech. Move it **higher** if it reacts to background noise |
| **Keep continuous listening** | Starts listening automatically when you open a page |
| **High contrast overlay** | Makes Rito's on-screen messages easier to see |
| **Custom command shortcuts** | Create your own phrases. Example: make "send it" mean "click submit" |
| **Groq API key** | Required for voice recognition and page summaries |

---

## 7. Troubleshooting

| Problem | Try this |
|---|---|
| **"Add a Groq API key…"** message | Paste your Groq key into Settings and save |
| **"Microphone permission denied"** | Click the 🔒 icon in the address bar, allow the microphone, then reload the page |
| Rito doesn't react until I click the page | Click anywhere on the page once. Browsers need this before the mic can start |
| Rito reacts to background noise or TV | Raise **Microphone sensitivity**, or turn on **wake phrase mode** |
| Rito misses what I say | Lower **Microphone sensitivity**, speak a little louder, and pause after each command |
| **"Groq free-tier limit reached"** | You've given a lot of commands quickly. Rito pauses briefly and then carries on by itself |
| The wrong thing gets clicked | Say "show numbers", then click by number |
| Nothing works on a certain website | Some sites (like Google's own pages) block extensions. Try a different site |
| Rito stopped when I switched tabs | This is normal. Rito turns off the mic in background tabs and turns it back on when you return |
