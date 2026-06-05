(function bootstrapPlanificadorModules() {
  "use strict";

  const criticalModules = [
    "ui-safety-net.js",
    "data-store.js",
    "stock-lifecycle.js"
  ];

  const optionalModules = [
    "import-export.js",
    "meal-costing.js",
    "shopping-planner.js",
    "waste-metrics.js",
    "index-hardening.js",
    "unit-normalization.js",
    "pack-preview-fix.js",
    "shopping-ui-bridge.js",
    "ux-dashboard.js",
    "mvp-insights.js",
    "purchase-mode.js"
  ];

  function alreadyLoaded(src) {
    return Array.from(document.scripts).some(script => (script.getAttribute("src") || "").split("?")[0].endsWith(src));
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (alreadyLoaded(src)) return resolve({ src, ok: true, skipped: true });
      const script = document.createElement("script");
      script.src = `${src}?v=20260605-purchase-list`;
      script.defer = false;
      script.onload = () => resolve({ src, ok: true });
      script.onerror = () => reject(new Error(`No se pudo cargar ${src}`));
      document.body.appendChild(script);
    });
  }

  async function loadCritical() {
    for (const module of criticalModules) {
      await loadScript(module);
    }
  }

  async function loadOptional() {
    const results = [];
    for (const module of optionalModules) {
      try {
        results.push(await loadScript(module));
      } catch (error) {
        console.warn(error);
        results.push({ src: module, ok: false, error: error.message });
      }
    }
    return results;
  }


  function installDynamicTabNavigation() {
    if (window.__planificadorDynamicTabsReady) return;
    window.__planificadorDynamicTabsReady = true;
    document.addEventListener("click", event => {
      const button = event.target && event.target.closest ? event.target.closest(".tab-btn[data-tab]") : null;
      if (!button || !document.body.contains(button)) return;
      const tabName = button.dataset.tab;
      if (!tabName) return;
      document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.toggle("active", btn.dataset.tab === tabName));
      document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.toggle("active", panel.id === `panel-${tabName}`));
    });
  }

  async function loadAll() {
    installDynamicTabNavigation();
    await loadCritical();
    const optionalResults = await loadOptional();
    const modules = [...criticalModules, ...optionalModules];
    document.dispatchEvent(new CustomEvent("planificador:modules-ready", { detail: { modules, optionalResults } }));
    if (window.UiSafetyNet && typeof window.UiSafetyNet.install === "function") window.UiSafetyNet.install();
    if (window.UxDashboard && typeof window.UxDashboard.install === "function") window.UxDashboard.install();
    if (window.MvpInsights && typeof window.MvpInsights.install === "function") window.MvpInsights.install();
    if (window.PurchaseMode && typeof window.PurchaseMode.install === "function") window.PurchaseMode.install();
  }

  loadAll().catch(error => {
    console.error(error);
    const box = document.getElementById("startup-error");
    const msg = document.getElementById("startup-error-message");
    if (box && msg) {
      box.style.display = "block";
      msg.textContent = `Error cargando modulos basicos: ${error.message}`;
    }
  });
})();
