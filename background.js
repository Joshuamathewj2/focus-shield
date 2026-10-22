// ============================================================
// background.js — Focus Shield Service Worker
// Runs in the background (even when popup is closed).
// Handles: blocking rules, Pomodoro timer, alarm scheduling.
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

// ── Pomodoro config (in minutes) ───────────────────────────
const POMODORO_WORK = 25;
const POMODORO_BREAK = 5;

// ── Helper: build a declarativeNetRequest rule from a domain ─
// Each rule needs a unique numeric ID.
function buildRule(domain, ruleId) {
  return {
    id: ruleId,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        // Redirect to our custom blocked page, telling it which site was blocked
        url: `${chrome.runtime.getURL("blocked.html")}?site=${encodeURIComponent(domain)}`
      }
    },
    condition: {
      // Match any URL that contains this domain
      urlFilter: `||${domain}^`,
      resourceTypes: ["main_frame"] // Only block top-level page loads
    }
  };
}

// ── Apply blocking rules to Chrome's declarativeNetRequest ──
// This replaces ALL current dynamic rules with a fresh set.
async function applyBlockingRules(sites) {
  // First, grab all existing dynamic rules so we can remove them
  const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
  const existingIds = existingRules.map(r => r.id);

  // Build fresh rules for each site (IDs start at 1)
  const newRules = sites.map((site, index) => buildRule(site, index + 1));

  // Atomically remove old rules and add new ones
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existingIds,
    addRules: newRules
  });

  console.log(`[Focus Shield] Applied ${newRules.length} blocking rules. Active domains: ${sites.join(', ')}`);
}

// ── Remove every blocking rule ──────────────────────────────
async function clearBlockingRules() {
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map(r => r.id),
    addRules: []
  });
}

// ── Save blocked sites list; only block if focus mode is on ──
async function saveAndApply(sites) {
  await chrome.storage.local.set({ blockedSites: sites });
  const { focusActive } = await chrome.storage.local.get("focusActive");
  if (focusActive) {
    await applyBlockingRules(sites);
  }
}

async function loadSites() {
  const result = await chrome.storage.local.get("blockedSites");
  if (!result.blockedSites) {
    console.log("[Focus Shield] First run: loading default blocked sites.");
    await chrome.storage.local.set({ blockedSites: DEFAULT_BLOCKED_SITES });
    return DEFAULT_BLOCKED_SITES;
  }
  console.log(`[Focus Shield] Loaded ${result.blockedSites.length} blocked sites from storage.`);
  return result.blockedSites;
}

// ── On extension install / Chrome startup ──────────────────
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[Focus Shield] Extension installed.");

  // Make sure blocking mode is OFF by default
  await chrome.storage.local.set({
    focusActive: false,
    pomodoroState: "idle", // idle | work | break
    pomodoroEndTime: null,
    sessionCount: 0
  });

  // Focus mode starts OFF, so nothing is blocked until the user starts a session.
  await loadSites();
  await clearBlockingRules();
});

// Re-apply rules whenever Chrome restarts (service worker wakes up)
chrome.runtime.onStartup.addListener(async () => {
  const sites = await loadSites();
  const { focusActive } = await chrome.storage.local.get("focusActive");
  if (focusActive) {
    await applyBlockingRules(sites);
  }
});

// ── Alarm handler — drives the Pomodoro timer ──────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === "pomodoroTick") {
    const { pomodoroState, sessionCount } = await chrome.storage.local.get([
      "pomodoroState",
      "sessionCount"
    ]);

    if (pomodoroState === "work") {
      // Work session ended → start a break
      const breakEnd = Date.now() + POMODORO_BREAK * 60 * 1000;
      const newCount = (sessionCount || 0) + 1;
      await chrome.storage.local.set({
        pomodoroState: "break",
        pomodoroEndTime: breakEnd,
        sessionCount: newCount
      });
      console.log(`[Focus Shield] Timer ended: Work session complete. Total sessions: ${newCount}. Starting 5-minute break.`);
      chrome.alarms.create("pomodoroTick", { delayInMinutes: POMODORO_BREAK });

      // Notify the user
      chrome.notifications?.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "Focus Shield",
        message: "Work session done! Take a 5-minute break 🎉"
      });

    } else if (pomodoroState === "break") {
      // Break ended → go back to work (blocking stays active)
      const workEnd = Date.now() + POMODORO_WORK * 60 * 1000;
      await chrome.storage.local.set({
        pomodoroState: "work",
        pomodoroEndTime: workEnd
      });
      chrome.alarms.create("pomodoroTick", { delayInMinutes: POMODORO_WORK });

      chrome.notifications?.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "Focus Shield",
        message: "Break over. Back to focus mode 🔒"
      });
    }
  }
});

// ── Message listener — popup sends commands here ────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse);
  return true; // Keep message channel open for async response
});

async function handleMessage(message) {
  const { action } = message;

  if (action === "setFocusActive") {
    const { active } = message;
    console.log(`[Focus Shield] Focus mode state toggled: ${active ? "ON" : "OFF"}`);
    await chrome.storage.local.set({ focusActive: active });

    if (active) {
      const sites = await loadSites();
      await applyBlockingRules(sites);
    } else {
      await clearBlockingRules();
      console.log("[Focus Shield] All blocking rules removed.");
    }
    return { ok: true };
  }

  // ── Update the blocked sites list ────────────────────────
  if (action === "updateSites") {
    const { sites } = message;
    await saveAndApply(sites);
    return { ok: true };
  }

  if (action === "startPomodoro") {
    console.log("[Focus Shield] Pomodoro timer started (Work Session). Enabling Focus mode.");
    // Activate focus blocking
    const sites = await loadSites();
    await applyBlockingRules(sites);
    await chrome.storage.local.set({ focusActive: true });

    const workEnd = Date.now() + POMODORO_WORK * 60 * 1000;
    await chrome.storage.local.set({
      pomodoroState: "work",
      pomodoroEndTime: workEnd
    });

    // Cancel any existing alarm then schedule new one
    await chrome.alarms.clear("pomodoroTick");
    chrome.alarms.create("pomodoroTick", { delayInMinutes: POMODORO_WORK });

    return { ok: true, endTime: workEnd };
  }

  if (action === "stopPomodoro") {
    console.log("[Focus Shield] Pomodoro timer stopped/reset by user. Disabling Focus mode.");
    await chrome.alarms.clear("pomodoroTick");
    await chrome.storage.local.set({
      pomodoroState: "idle",
      pomodoroEndTime: null,
      focusActive: false
    });

    await clearBlockingRules();
    return { ok: true };
  }

  // ── Get current state ────────────────────────────────────
  if (action === "getState") {
    const state = await chrome.storage.local.get([
      "blockedSites",
      "focusActive",
      "pomodoroState",
      "pomodoroEndTime",
      "sessionCount"
    ]);
    return state;
  }

  return { ok: false, error: "Unknown action" };
}
