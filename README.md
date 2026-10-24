<p align="center"><img src="icons/icon128.png" width="96" alt="Focus Shield icon"></p>

# Focus Shield

A Chrome extension (Manifest V3) that blocks distracting sites while you work, paired with a built-in Pomodoro timer.

## Features

- **Focus mode on demand.** Nothing is blocked until you start a session; stopping the session unblocks everything.
- **Pomodoro cycles.** 25 minutes of focus, 5 minutes of break, repeating, with a desktop notification at each switch. Sessions are counted.
- **Your own block list.** Starts with YouTube, Instagram, X/Twitter, Facebook, Reddit and TikTok; add or remove domains from the popup. Subdomains are covered (`m.youtube.com`, `www.reddit.com`…).
- **A calm blocked page** that names the site you tried to open and shows a rotating focus quote, instead of a browser error.
- **Native blocking** with `declarativeNetRequest`: Chrome blocks the request itself, so there's no page flash and no script running on every site.

## Install (developer mode)

1. Clone or download this repository.
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and select the project folder.
4. Pin **Focus Shield** and click it to start a session.

## How it works

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest: permissions, service worker, popup, icons |
| `background.js` | Service worker. Turns the block list into dynamic `declarativeNetRequest` redirect rules, drives the Pomodoro cycle with `chrome.alarms` (survives the worker sleeping), sends notifications |
| `popup.html` / `popup.js` | Start/stop sessions, live countdown, edit the block list. Talks to the worker with `chrome.runtime.sendMessage` |
| `blocked.html` / `blocked.js` | The page blocked sites redirect to (`?site=` names the domain) |
| `generator.html` | Helper page used to draw the PNG icon sizes |

Each blocked domain becomes one rule:

```js
{ action: { type: "redirect", redirect: { url: "chrome-extension://…/blocked.html?site=youtube.com" } },
  condition: { urlFilter: "||youtube.com^", resourceTypes: ["main_frame"] } }
```

Rules are only installed while focus mode is on and are removed atomically when it ends.

## Permissions

| Permission | Why |
|---|---|
| `declarativeNetRequest`, `declarativeNetRequestWithHostAccess`, `<all_urls>` | Redirect blocked domains to the focus page |
| `storage` | Block list, timer state, session count |
| `alarms` | Pomodoro timer that keeps running when the popup is closed |
| `notifications` | "Break time" / "Back to focus" alerts |
| `tabs` | Read the active tab for the popup |

No data leaves your browser.

## License

MIT
