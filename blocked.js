// ── Show which domain was blocked ──────────────────────
// The blocked URL is passed as a query param by the extension
const params = new URLSearchParams(window.location.search);
const site = params.get("site");
const originalUrl = params.get("url");

if (site) {
  document.getElementById("blockedDomain").textContent = decodeURIComponent(site);
}

// ── Close Tab button ────────────────────────────────────
document.getElementById("goBackBtn").addEventListener("click", () => {
  if (typeof chrome !== "undefined" && chrome.tabs && chrome.tabs.getCurrent) {
    chrome.tabs.getCurrent((tab) => {
      if (tab && tab.id) {
        chrome.tabs.remove(tab.id, () => {
          if (chrome.runtime && chrome.runtime.lastError) {
            window.close();
          }
        });
      } else {
        window.close();
      }
    });
  } else {
    window.close();
  }
});

// ── Auto-restore page if site is unblocked or Focus Mode is turned off ─
if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    chrome.storage.local.get(["blockedSites", "focusActive"], ({ blockedSites = [], focusActive = true }) => {
      const cleanSite = (site || "").toLowerCase().replace(/^www\./, "");
      const stillBlocked =
        focusActive &&
        cleanSite &&
        blockedSites.some(s => cleanSite === s || cleanSite.endsWith("." + s));

      if (!stillBlocked && (originalUrl || cleanSite)) {
        window.location.replace(originalUrl || `https://${cleanSite}`);
      }
    });
  });
}
