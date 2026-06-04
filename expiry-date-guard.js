/*
 * Expiry date guard for PlanificadorComidas.
 * Adds alerts for stock items without expiry/preparation/freezing dates so they are not invisible.
 */
(function attachExpiryDateGuard(global) {
  "use strict";

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function itemName(item) {
    return item.name || item.nombre || "Sin nombre";
  }

  function hasStock(item) {
    return item.available === true || numberOrZero(item.qty ?? item.cantidad ?? item.stock ?? item.racionesPreparadas) > 0;
  }

  function hasAnyLifecycleDate(item) {
    return Boolean(item.expiryDate || item.openedDate || item.preparedDate || item.frozenDate || item.caducidad || item.fechaCaducidad || item.fechaApertura || item.fechaPreparacion || item.fechaCongelado);
  }

  function normalizeIngredient(item) {
    return global.StockLifecycle?.normalizeIngredientStock ? global.StockLifecycle.normalizeIngredientStock(item) : item;
  }

  function normalizeDish(item) {
    return global.StockLifecycle?.normalizeDishStock ? global.StockLifecycle.normalizeDishStock(item) : item;
  }

  function buildMissingDateAlerts({ ingredients = [], dishes = [] } = {}, options = {}) {
    if (options.includeMissingDates === false) return [];
    const alerts = [];

    ingredients.map(normalizeIngredient).forEach(item => {
      if (!hasStock(item)) return;
      if (hasAnyLifecycleDate(item)) return;
      alerts.push({
        severity: "missing-date",
        itemType: "Ingrediente",
        id: item.id || "",
        name: itemName(item),
        days: 9999,
        message: "Sin fecha de caducidad registrada",
        action: "Añadir caducidad, fecha de apertura o congelado para que pueda avisar a tiempo"
      });
    });

    dishes.map(normalizeDish).forEach(item => {
      if (!hasStock(item)) return;
      if (hasAnyLifecycleDate(item)) return;
      alerts.push({
        severity: "missing-date",
        itemType: "Plato",
        id: item.id || "",
        name: itemName(item),
        days: 9999,
        message: "Sin fecha de preparación o caducidad registrada",
        action: "Añadir fecha de preparación, caducidad o congelado"
      });
    });

    return alerts.sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  function install() {
    const stock = global.StockLifecycle;
    if (!stock || stock.__expiryDateGuardInstalled) return false;

    const originalBuildExpiryAlerts = stock.buildExpiryAlerts;
    const originalBuildRecommendations = stock.buildConsumptionRecommendations;
    const originalCalculateWasteScore = stock.calculateWasteScore;

    stock.buildMissingDateAlerts = buildMissingDateAlerts;

    stock.buildExpiryAlerts = function guardedBuildExpiryAlerts(data = {}, options = {}) {
      const alerts = typeof originalBuildExpiryAlerts === "function" ? originalBuildExpiryAlerts(data, options) : [];
      const missing = buildMissingDateAlerts(data, options);
      const severityWeight = { expired: 0, today: 1, soon: 2, freezer: 3, "missing-date": 4 };
      return [...alerts, ...missing].sort((a, b) =>
        (severityWeight[a.severity] ?? 9) - (severityWeight[b.severity] ?? 9) ||
        (a.days ?? 9999) - (b.days ?? 9999) ||
        a.name.localeCompare(b.name, "es")
      );
    };

    stock.buildConsumptionRecommendations = function guardedBuildConsumptionRecommendations(data = {}, options = {}) {
      const alerts = stock.buildExpiryAlerts(data, options);
      const severityScore = { expired: 100, today: 80, soon: 60, freezer: 35, "missing-date": 20 };
      return alerts.map(alert => ({
        ...alert,
        priority: severityScore[alert.severity] || 0,
        title: `${alert.name}: ${alert.message}`,
        suggestion: alert.severity === "missing-date"
          ? "Completa sus fechas para que el planificador pueda priorizarlo correctamente."
          : alert.severity === "expired"
            ? "Revisa olor, textura y seguridad antes de consumir; descarta si hay duda."
            : alert.severity === "freezer"
              ? "Incluyelo en una comida proxima para rotar el congelador."
              : "Dale prioridad en el calendario antes de comprar mas."
      })).sort((a, b) => b.priority - a.priority || (a.days ?? 9999) - (b.days ?? 9999) || a.name.localeCompare(b.name, "es"));
    };

    stock.calculateWasteScore = function guardedCalculateWasteScore(data = {}, options = {}) {
      const base = typeof originalCalculateWasteScore === "function" ? originalCalculateWasteScore(data, { ...options, includeMissingDates: false }) : {};
      const alerts = stock.buildExpiryAlerts(data, options);
      const missingDateCount = alerts.filter(alert => alert.severity === "missing-date").length;
      const missingDatePenalty = Math.min(15, missingDateCount * 2);
      const score = Math.max(0, Math.min(100, Math.round(numberOrZero(base.score ?? 100) - missingDatePenalty)));
      let label = base.label || "Excelente";
      if (score < 40) label = "Alto riesgo de desperdicio";
      else if (score < 70) label = "Mejorable";
      else if (score < 90) label = "Bueno";
      else label = "Excelente";

      return {
        ...base,
        score,
        label,
        missingDateCount,
        alerts,
        recommendations: stock.buildConsumptionRecommendations(data, options)
      };
    };

    stock.__expiryDateGuardInstalled = true;
    return true;
  }

  install();
  document.addEventListener?.("planificador:modules-ready", install);

  global.ExpiryDateGuard = {
    buildMissingDateAlerts,
    install
  };
})(typeof window !== "undefined" ? window : globalThis);
