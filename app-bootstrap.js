(function(){
  "use strict";
  const modules=[
    "ui-safety-net.js","data-store.js","stock-lifecycle.js",
    "import-export.js","meal-costing.js","shopping-planner.js","waste-metrics.js",
    "index-hardening.js","unit-normalization.js","pack-preview-fix.js",
    "shopping-ui-bridge.js","ux-dashboard.js","mvp-insights.js","purchase-mode.js"
  ];
  const version="20260605-purchase-mode";
  const loaded=s=>Array.from(document.scripts).some(x