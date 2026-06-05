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
    return Array.from