# LinkVault & Focus Shield

<p align="center">
  <img src="icons/logo.png" width="128" height="128" alt="LinkVault & Focus Shield Logo" style="border-radius: 20px;">
</p>

<p align="center">
  <strong>The All-in-One Browser Productivity Suite</strong><br>
  Save, organize, and search web resources with <strong>LinkVault</strong>, while eliminating digital distractions with <strong>Focus Shield</strong>.
</p>

---

## Features

### 🔗 LinkVault (Vault Tab)
- **Instant Website Saving**: Automatically captures active tab URL and page title.
- **Tagging & Organization**: Tag resources (e.g. `ai`, `research`, `tools`) and add custom notes.
- **Instant Search**: Real-time filtering across titles, URLs, descriptions, and tags.
- **Quick Actions**: 1-click open link, favorite, edit, and delete (`✕`).
- **Data Portability**: Clean **Download JSON** export for backup and portability.

### 🛡 Focus Shield (Shield Tab)
- **Native Website Blocking**: Uses Chrome's native `declarativeNetRequest` API for zero page-flash and zero memory overhead.
- **1-Click Current Tab Block**: Instantly detects and blocks or unblocks whatever site you're currently browsing.
- **Focus Mode Toggle**: Easily turn distraction blocking ON or OFF with a single switch.
- **Distraction-Free Block Page**: When visiting a blocked domain, a minimal blocked screen appears with an instant **✕ Close Tab** action.

### ⚡ Performance & Design
- **Sub-50ms Instant Popup**: Built without blocking network fonts or heavy IPC locks for immediate popup opening.
- **Pure Dark & Neon White Glow Theme**: Obsidian black background with luminous neon white glowing borders and rounded contours.

---

## Installation (Developer Mode)

1. Clone or download this repository:
   ```bash
   git clone https://github.com/Joshuamathewj2/focus-shield.git
   ```
2. Open Chrome and navigate to:
   ```
   chrome://extensions
   ```
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the extension folder (`linkvault` or `focus-shield`).
5. Pin **LinkVault & Focus Shield** to your browser toolbar!

---

## File Structure

```
├── manifest.json         # Manifest V3 configuration & permissions
├── popup.html            # Main extension interface with Vault/Shield navbar
├── popup.css             # Neon white dark theme stylesheet
├── popup.js              # Navbar navigation controller
├── popup-vault.js        # LinkVault logic (save, search, favorite, edit)
├── popup-shield.js       # Focus Shield logic (toggle, block list, DNR sync)
├── storage.js            # LinkVault local storage engine
├── background.js         # Service worker handling background DNR rules & tab monitoring
├── blocked.html          # Blocked website splash screen
├── blocked.js            # Blocked page logic (instant tab closure)
├── rules.json            # Base declarativeNetRequest ruleset definition
└── icons/                # High-res logos and extension icon sizes (16, 48, 128)
```

---

## Permissions

| Permission | Purpose |
|---|---|
| `storage` | Persists saved bookmarks, blocked domains, and focus mode toggle state |
| `declarativeNetRequest` | High-performance native URL redirection for blocked websites |
| `declarativeNetRequestWithHostAccess` | Applies dynamic host rules cleanly |
| `tabs` / `activeTab` | Detects current page URL/domain for 1-click actions and tab closing |
| `<all_urls>` | Host permission for matching blocked domains |

---

## License

MIT License
