// ============================================================
// background.js — Focus Shield Service Worker
// Handles website blocking rules via declarativeNetRequest
// and active tab enforcement.
// ============================================================

// ── Default blocked sites loaded on first install ──────────
const DEFAULT_BLOCKED_SITES = [
  "youtube.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "facebook.com",
  "reddit.com",
  "tiktok.com"
];

// ── Normalize any URL or domain string to a clean hostname ─
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

// ── Extract domain from a live URL (or from our blocked.html) ─
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

// ── Check if a URL matches any domain in blockedSites ──────
function findMatchingBlockedSite(rawUrl, blockedSites) {
  if (!rawUrl || !Array.isArray(blockedSites) || blockedSites.length === 0) {
    return null;
  }
  const host = normalizeDomain(rawUrl);
  if (!host) return null;

  for (const rawSite of blockedSites) {
    const site = normalizeDomain(rawSite);
    if (!site) continue;
    if (host === site || host.endsWith("." + site)) {
      return site;
    }
  }
  return null;
}

// ── Helper: build a declarativeNetRequest rule from a domain ─
function buildRulesForSite(domain, baseId) {
  const blockedPagePath = `/blocked.html?site=${encodeURIComponent(domain)}`;
  return [
    {
      id: baseId,
      priority: 1,
      action: {
        type: "redirect",
        redirect: {
          extensionPath: blockedPagePath
        }
      },
      condition: {
        urlFilter: `||${domain}^`,
        resourceTypes: ["main_frame"]
      }
    }
  ];
}

// ── Serialize dynamic rule updates to prevent ID collisions ─
let ruleUpdateQueue = Promise.resolve();

function syncDynamicRules(sites, focusActive) {
  ruleUpdateQueue = ruleUpdateQueue
    .then(async () => {
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const existingIds = existingRules.map(r => r.id);

      const newRules = [];
      if (focusActive && Array.isArray(sites)) {
        const cleanSites = [...new Set(sites.map(normalizeDomain).filter(Boolean))];
        cleanSites.forEach((site, idx) => {
          newRules.push(...buildRulesForSite(site, idx + 1));
        });
      }

      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: existingIds,
        addRules: newRules
      });
    })
    .catch(err => {
      console.error("[Focus Shield] Error updating dynamic rules:", err);
    });

  return ruleUpdateQueue;
}

// ── Enforce blocking or unblocking on currently open tabs ──
async function enforceTabsState(sites, focusActive) {
  try {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      if (!tab.id || !tab.url) continue;

      const blockedInfo = getBlockedPageInfo(tab.url);

      if (blockedInfo) {
        const stillBlocked =
          focusActive &&
          blockedInfo.site &&
          Boolean(findMatchingBlockedSite(`https://${blockedInfo.site}`, sites));

        if (!stillBlocked && blockedInfo.originalUrl) {
          chrome.tabs.update(tab.id, { url: blockedInfo.originalUrl }).catch(() => {});
        }
        continue;
      }

      if (focusActive) {
        const matchedSite = findMatchingBlockedSite(tab.url, sites);
        if (matchedSite) {
          const redirectUrl = chrome.runtime.getURL(
            `/blocked.html?site=${encodeURIComponent(matchedSite)}&url=${encodeURIComponent(tab.url)}`
          );
          chrome.tabs.update(tab.id, { url: redirectUrl }).catch(() => {});
        }
      }
    }
  } catch (err) {
    console.warn("[Focus Shield] Could not enforce state on tabs:", err);
  }
}

// ── Load & initialize state from storage ───────────────────
async function ensureState() {
  const data = await chrome.storage.local.get(["blockedSites", "focusActive"]);

  let blockedSites = data.blockedSites;
  if (!Array.isArray(blockedSites)) {
    blockedSites = [...DEFAULT_BLOCKED_SITES];
  } else {
    blockedSites = [...new Set(blockedSites.map(normalizeDomain).filter(Boolean))];
  }

  const focusActive = typeof data.focusActive === "boolean" ? data.focusActive : true;

  if (!Array.isArray(data.blockedSites) || typeof data.focusActive !== "boolean") {
    await chrome.storage.local.set({ blockedSites, focusActive });
  }

  return { blockedSites, focusActive };
}

// ── Apply full state (storage + DNR rules + open tabs) ─────
async function applyFullState(blockedSites, focusActive) {
  const cleanSites = [...new Set(blockedSites.map(normalizeDomain).filter(Boolean))];
  await chrome.storage.local.set({
    blockedSites: cleanSites,
    focusActive: Boolean(focusActive)
  });
  await syncDynamicRules(cleanSites, Boolean(focusActive));
  await enforceTabsState(cleanSites, Boolean(focusActive));
  return { blockedSites: cleanSites, focusActive: Boolean(focusActive) };
}

// ── On extension install / update ──────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  const { blockedSites, focusActive } = await ensureState();
  await syncDynamicRules(blockedSites, focusActive);
  await enforceTabsState(blockedSites, focusActive);
});

// ── Re-apply rules whenever Chrome starts up ────────────────
chrome.runtime.onStartup.addListener(async () => {
  const { blockedSites, focusActive } = await ensureState();
  await syncDynamicRules(blockedSites, focusActive);
  await enforceTabsState(blockedSites, focusActive);
});

// ── React automatically when popup updates chrome.storage ───
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  if (changes.blockedSites || changes.focusActive) {
    const { blockedSites, focusActive } = await ensureState();
    await syncDynamicRules(blockedSites, focusActive);
    await enforceTabsState(blockedSites, focusActive);
  }
});

// ── Intercept tab navigations (handles Service Worker & SPA pages) ─
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const targetUrl = changeInfo.url || tab?.url;
  if (!targetUrl || (!changeInfo.url && changeInfo.status !== "loading")) return;
  if (getBlockedPageInfo(targetUrl)) return;

  const { blockedSites, focusActive } = await ensureState();
  if (!focusActive) return;

  const matchedSite = findMatchingBlockedSite(targetUrl, blockedSites);
  if (matchedSite) {
    const redirectUrl = chrome.runtime.getURL(
      `/blocked.html?site=${encodeURIComponent(matchedSite)}&url=${encodeURIComponent(targetUrl)}`
    );
    chrome.tabs.update(tabId, { url: redirectUrl }).catch(() => {});
  }
});

// ── Message listener — popup sends commands here ────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch(err => {
      console.error("[Focus Shield] Message error:", err);
      sendResponse({ ok: false, error: err?.message || "Unknown error" });
    });
  return true;
});

async function handleMessage(message) {
  const { action } = message || {};
  const state = await ensureState();

  if (action === "getState") {
    await syncDynamicRules(state.blockedSites, state.focusActive);
    return {
      ok: true,
      blockedSites: state.blockedSites,
      focusActive: state.focusActive
    };
  }

  if (action === "setFocusActive") {
    const active = Boolean(message.active);
    const updated = await applyFullState(state.blockedSites, active);
    return { ok: true, ...updated };
  }

  if (action === "addSite") {
    const cleanSite = normalizeDomain(message.site);
    if (!cleanSite) {
      return { ok: false, error: "Invalid domain" };
    }
    const alreadyExists = state.blockedSites.includes(cleanSite);
    const nextSites = alreadyExists
      ? state.blockedSites
      : [cleanSite, ...state.blockedSites];

    const updated = await applyFullState(nextSites, true);
    return {
      ok: true,
      alreadyExists,
      site: cleanSite,
      ...updated
    };
  }

  if (action === "removeSite") {
    const cleanSite = normalizeDomain(message.site);
    let nextSites = state.blockedSites;

    if (cleanSite) {
      nextSites = state.blockedSites.filter(
        s => s !== cleanSite && !cleanSite.endsWith("." + s)
      );
    } else if (typeof message.index === "number") {
      nextSites = state.blockedSites.filter((_, i) => i !== message.index);
    }

    const updated = await applyFullState(nextSites, state.focusActive);
    return {
      ok: true,
      site: cleanSite,
      ...updated
    };
  }

  if (action === "updateSites") {
    const sites = Array.isArray(message.sites) ? message.sites : [];
    const updated = await applyFullState(sites, state.focusActive);
    return { ok: true, ...updated };
  }

  return { ok: false, error: "Unknown action" };
}
