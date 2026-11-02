// ============================================================
// popup-shield.js — Focus Shield Popup Controller
// Directly manages storage, declarativeNetRequest rules, and
// active tab blocking/unblocking so it works immediately.
// ============================================================

(() => {
  const DEFAULT_BLOCKED_SITES = [
    "youtube.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "facebook.com",
    "reddit.com",
    "tiktok.com"
  ];

  // ── DOM references ──────────────────────────────────────────
  const focusToggle      = document.getElementById("focusToggle");
  const focusStatus      = document.getElementById("focusStatus");
  const siteCount        = document.getElementById("siteCount");
  const siteInput        = document.getElementById("siteInput");
  const addSiteBtn       = document.getElementById("addSiteBtn");
  const sitesList        = document.getElementById("sitesList");
  const captureBadge     = document.getElementById("captureBadge");
  const feedbackMsg      = document.getElementById("shieldFeedbackMsg");
  const currentTabCard   = document.getElementById("currentTabCard");
  const currentTabDomain = document.getElementById("currentTabDomain");
  const quickToggleBtn   = document.getElementById("quickToggleBtn");

  let feedbackTimer = null;
  let currentSites = [];
  let isFocusActive = true;
  let activeTabDomain = "";

  // ── Utility: display feedback message ──────────────────────
  function showFeedback(text, type = "info") {
    if (!feedbackMsg) return;
    clearTimeout(feedbackTimer);
    feedbackMsg.textContent = text;
    feedbackMsg.className = `feedback-msg ${type}`;
    feedbackMsg.style.display = "block";
    feedbackTimer = setTimeout(() => {
      feedbackMsg.style.display = "none";
    }, 2600);
  }

  // ── Normalize any domain or URL string ─────────────────────
  function normalizeDomain(rawInput) {
    if (!rawInput || typeof rawInput !== "string") return "";
    let input = rawInput.trim().toLowerCase();
    if (!input) return "";

    try {
      if (!input.includes("://")) {
        input = "https://" + input;
      }
      const parsed = new URL(input);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      const host = parsed.hostname.replace(/^www\./, "").replace(/\.+$/, "");
      if (!host || !host.includes(".")) return "";
      return host;
    } catch {
      return "";
    }
  }

  // ── Check if a tab URL is our blocked.html page ────────────
  function getBlockedPageInfo(rawUrl) {
    if (!rawUrl) return null;
    try {
      const blockedBase = chrome.runtime.getURL("/blocked.html");
      if (rawUrl.startsWith(blockedBase)) {
        const parsed = new URL(rawUrl);
        const site = normalizeDomain(parsed.searchParams.get("site") || "");
        const originalUrl = parsed.searchParams.get("url") || (site ? `https://${site}` : "");
        return { site, originalUrl };
      }
    } catch {
      // ignore
    }
    return null;
  }

  // ── Extract domain from active tab URL (including blocked.html) ─
  function extractTabDomain(rawUrl) {
    if (!rawUrl) return "";
    const blockedInfo = getBlockedPageInfo(rawUrl);
    if (blockedInfo && blockedInfo.site) {
      return blockedInfo.site;
    }
    return normalizeDomain(rawUrl);
  }

  // ── Find matching blocked entry for a given domain ─────────
  function findBlockedMatch(domain, blockedSites) {
    const cleanDomain = normalizeDomain(domain);
    if (!cleanDomain || !Array.isArray(blockedSites)) return null;
    for (const rawSite of blockedSites) {
      const site = normalizeDomain(rawSite);
      if (!site) continue;
      if (cleanDomain === site || cleanDomain.endsWith("." + site)) {
        return site;
      }
    }
    return null;
  }

  // ── Directly apply declarativeNetRequest rules ─────────────
  async function applyDynamicRules(sites, focusActive) {
    try {
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const existingIds = existingRules.map(r => r.id);

      const newRules = [];
      if (focusActive && Array.isArray(sites)) {
        const cleanSites = [...new Set(sites.map(normalizeDomain).filter(Boolean))];
        cleanSites.forEach((domain, idx) => {
          newRules.push({
            id: idx + 1,
            priority: 1,
            action: {
              type: "redirect",
              redirect: {
                extensionPath: `/blocked.html?site=${encodeURIComponent(domain)}`
              }
            },
            condition: {
              urlFilter: `||${domain}^`,
              resourceTypes: ["main_frame"]
            }
          });
        });
      }

      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingIds,
        addRules: newRules
      });
    } catch (err) {
      console.warn("[Focus Shield] Rule sync warning:", err);
    }
  }

  // ── Redirect newly blocked tabs or restore unblocked tabs ──
  async function enforceOpenTabs(sites, focusActive) {
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (!tab.id || !tab.url) continue;

        const blockedInfo = getBlockedPageInfo(tab.url);
        if (blockedInfo) {
          const stillBlocked =
            focusActive &&
            blockedInfo.site &&
            Boolean(findBlockedMatch(blockedInfo.site, sites));

          if (!stillBlocked && blockedInfo.originalUrl) {
            chrome.tabs.update(tab.id, { url: blockedInfo.originalUrl }).catch(() => {});
          }
          continue;
        }

        if (focusActive) {
          const matchedSite = findBlockedMatch(tab.url, sites);
          if (matchedSite) {
            const redirectUrl = chrome.runtime.getURL(
              `/blocked.html?site=${encodeURIComponent(matchedSite)}&url=${encodeURIComponent(tab.url)}`
            );
            chrome.tabs.update(tab.id, { url: redirectUrl }).catch(() => {});
          }
        }
      }
    } catch (err) {
      console.warn("[Focus Shield] Tab enforcement warning:", err);
    }
  }

  // ── Save state, apply rules, and notify background worker ──
  async function saveStateAndApply(sites, focusActive) {
    const cleanSites = [...new Set(sites.map(normalizeDomain).filter(Boolean))];
    const active = Boolean(focusActive);

    currentSites = cleanSites;
    isFocusActive = active;

    await chrome.storage.local.set({
      blockedSites: cleanSites,
      focusActive: active
    });

    await applyDynamicRules(cleanSites, active);
    await enforceOpenTabs(cleanSites, active);

    try {
      chrome.runtime.sendMessage({ action: "setFocusActive", active }, () => {
        void chrome.runtime.lastError;
      });
      chrome.runtime.sendMessage({ action: "updateSites", sites: cleanSites }, () => {
        void chrome.runtime.lastError;
      });
    } catch {
      // ignore
    }
  }

  // ── Update Current Tab Quick Action UI ─────────────────────
  function updateCurrentTabUI() {
    if (!activeTabDomain) {
      if (currentTabCard) currentTabCard.style.display = "none";
      if (captureBadge) captureBadge.style.display = "none";
      return;
    }

    const matchedSite = findBlockedMatch(activeTabDomain, currentSites);
    const isBlocked = Boolean(matchedSite);

    if (currentTabCard && currentTabDomain && quickToggleBtn) {
      currentTabCard.style.display = "flex";
      currentTabDomain.textContent = matchedSite || activeTabDomain;

      if (isBlocked) {
        quickToggleBtn.textContent = "Remove Block";
        quickToggleBtn.className = "btn btn-quick is-blocked";
        quickToggleBtn.title = `Remove ${matchedSite} from blocklist`;
      } else {
        quickToggleBtn.textContent = "+ Block Site";
        quickToggleBtn.className = "btn btn-quick";
        quickToggleBtn.title = `Block ${activeTabDomain}`;
      }
    }

    if (captureBadge) {
      if (isBlocked) {
        captureBadge.textContent = "Currently Blocked";
        captureBadge.className = "capture-badge warning";
      } else {
        captureBadge.textContent = "Tab Captured";
        captureBadge.className = "capture-badge active";
      }
      captureBadge.style.display = "inline-block";
    }
  }

  // ── Auto-capture active tab link on popup open ─────────────
  async function detectActiveTab() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tabs || tabs.length === 0) return;

      const domain = extractTabDomain(tabs[0].url);
      if (domain) {
        activeTabDomain = domain;
        const isBlocked = Boolean(findBlockedMatch(domain, currentSites));
        if (!isBlocked && siteInput) {
          siteInput.value = domain;
        }
      }
    } catch (err) {
      console.warn("[Focus Shield] Could not capture active tab:", err);
    }
    updateCurrentTabUI();
  }

  // ── Render the blocked sites list ──────────────────────────
  function renderSites(sites) {
    currentSites = Array.isArray(sites) ? sites : [];
    if (sitesList) sitesList.innerHTML = "";
    if (siteCount) siteCount.textContent = currentSites.length;

    updateCurrentTabUI();

    if (!sitesList) return;

    if (currentSites.length === 0) {
      sitesList.innerHTML = `<li class="empty-msg">No sites in blocklist.</li>`;
      return;
    }

    currentSites.forEach((site) => {
      const li = document.createElement("li");
      const isCurrentSite =
        activeTabDomain &&
        (activeTabDomain === site || activeTabDomain.endsWith("." + site));

      li.className = isCurrentSite ? "site-item current-site-item" : "site-item";

      const iconSpan = document.createElement("span");
      iconSpan.className = "site-favicon";
      iconSpan.textContent = "🌐";

      const nameSpan = document.createElement("span");
      nameSpan.className = "site-name";
      nameSpan.textContent = site;

      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.title = `Remove ${site} from blocklist`;
      removeBtn.textContent = "Remove ✕";
      removeBtn.addEventListener("click", () => removeSiteByName(site));

      li.appendChild(iconSpan);
      li.appendChild(nameSpan);
      li.appendChild(removeBtn);
      sitesList.appendChild(li);
    });
  }

  // ── Add a site to the blocklist ────────────────────────────
  async function addSiteByDomain(rawDomain) {
    const cleanDomain = normalizeDomain(rawDomain);

    if (!cleanDomain) {
      if (siteInput) {
        siteInput.classList.add("shake");
        setTimeout(() => siteInput.classList.remove("shake"), 400);
      }
      showFeedback("Enter a valid domain (e.g. youtube.com)", "error");
      return;
    }

    const alreadyExists = currentSites.includes(cleanDomain);
    const updatedSites = alreadyExists
      ? currentSites
      : [cleanDomain, ...currentSites];

    await saveStateAndApply(updatedSites, true);
    setFocusUI(true);
    renderSites(updatedSites);

    if (alreadyExists) {
      showFeedback(`${cleanDomain} is already in your blocklist`, "warning");
    } else {
      showFeedback(`Blocked ${cleanDomain}`, "success");
      if (siteInput && normalizeDomain(siteInput.value) === cleanDomain) {
        siteInput.value = "";
      }
    }
  }

  // ── Remove a site from the blocklist ───────────────────────
  async function removeSiteByName(site) {
    const cleanDomain = normalizeDomain(site);
    if (!cleanDomain) return;

    const updatedSites = currentSites.filter(
      s => s !== cleanDomain && !cleanDomain.endsWith("." + s)
    );

    await saveStateAndApply(updatedSites, isFocusActive);
    renderSites(updatedSites);
    showFeedback(`Removed ${cleanDomain} from blocklist`, "info");
  }

  // ── Update focus toggle UI ──────────────────────────────────
  function setFocusUI(isActive) {
    isFocusActive = Boolean(isActive);
    if (focusToggle) focusToggle.checked = isFocusActive;
    if (focusStatus) {
      focusStatus.textContent = isFocusActive
        ? "Distraction blocking is ON 🔒"
        : "Distraction blocking is OFF";
      focusStatus.style.color = isFocusActive ? "var(--green)" : "var(--text-muted)";
    }
  }

  // ── Event: toggle focus mode ────────────────────────────────
  if (focusToggle) {
    focusToggle.addEventListener("change", async () => {
      const active = focusToggle.checked;
      setFocusUI(active);
      await saveStateAndApply(currentSites, active);
      renderSites(currentSites);
    });
  }

  // ── Event: 1-click block/unblock current tab ───────────────
  if (quickToggleBtn) {
    quickToggleBtn.addEventListener("click", async () => {
      if (!activeTabDomain) return;
      const matchedSite = findBlockedMatch(activeTabDomain, currentSites);
      if (matchedSite) {
        await removeSiteByName(matchedSite);
      } else {
        await addSiteByDomain(activeTabDomain);
      }
    });
  }

  // ── Event: add site via input button ────────────────────────
  if (addSiteBtn) {
    addSiteBtn.addEventListener("click", () => {
      if (siteInput) addSiteByDomain(siteInput.value);
    });
  }

  // ── Event: add site via Enter key ──────────────────────────
  if (siteInput) {
    siteInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        addSiteByDomain(siteInput.value);
      }
    });
  }

  // ── INIT: load state directly from storage & detect tab ─────
  async function init() {
    const data = await chrome.storage.local.get(["blockedSites", "focusActive"]);

    let sites = data.blockedSites;
    if (!Array.isArray(sites)) {
      sites = [...DEFAULT_BLOCKED_SITES];
      chrome.storage.local.set({ blockedSites: sites, focusActive: true });
      applyDynamicRules(sites, true);
    } else {
      sites = [...new Set(sites.map(normalizeDomain).filter(Boolean))];
    }

    const active = typeof data.focusActive === "boolean" ? data.focusActive : true;

    // Render UI instantly without blocking on DNR network/IPC calls
    setFocusUI(active);
    renderSites(sites);
    detectActiveTab();
  }

  // Expose hooks for tab switching
  window.focusShieldDetectTab = detectActiveTab;
  window.focusShieldRender = renderSites;

  init();
})();
