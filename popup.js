// ============================================================
// popup.js — Main navigation & view controller
// Toggles between LinkVault and Focus Shield views seamlessly.
// ============================================================

(() => {
  const tabVault = document.getElementById("tabVault");
  const tabShield = document.getElementById("tabShield");
  const viewVault = document.getElementById("viewVault");
  const viewShield = document.getElementById("viewShield");

  function switchTab(tabName) {
    if (tabName === "shield") {
      tabShield.classList.add("active");
      tabVault.classList.remove("active");
      viewShield.style.display = "block";
      viewVault.style.display = "none";
      try {
        localStorage.setItem("active_nav_tab", "shield");
      } catch {}

      if (typeof window.focusShieldDetectTab === "function") {
        window.focusShieldDetectTab();
      }
    } else {
      tabVault.classList.add("active");
      tabShield.classList.remove("active");
      viewVault.style.display = "block";
      viewShield.style.display = "none";
      try {
        localStorage.setItem("active_nav_tab", "vault");
      } catch {}

      if (typeof window.linkVaultPrefill === "function") {
        window.linkVaultPrefill();
      }
    }
  }

  if (tabVault && tabShield) {
    tabVault.addEventListener("click", () => switchTab("vault"));
    tabShield.addEventListener("click", () => switchTab("shield"));
  }

  // Restore previous active tab or default to 'vault'
  let savedTab = "vault";
  try {
    savedTab = localStorage.getItem("active_nav_tab") || "vault";
  } catch {}

  switchTab(savedTab);
})();
