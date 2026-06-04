/*
 * Stock lifecycle helpers for PlanificadorComidas.
 * Adds normalized expiry/preparation/freezing metadata, missing-date alerts
 * and food-waste scoring.
 */
(function attachStockLifecycle(global) {
  "use strict";

  const STORAGE_TYPES = ["pantry", "fridge", "freezer"];
  const DATE_FIELDS = ["expiryDate", "openedDate", "preparedDate", "frozenDate", "discardedDate", "consumedDate"];
  const OVERRIDE_STORE_KEY = "planificadorLifecycleOverrides";
  const DEFAULT_LIFE_DAYS = {
    ingredient: { pantry: 30, fridge: 5, freezer: 90, opened: 4 },
    dish: { pantry: 1, fridge: 3, freezer: 90, prepared: 3 }
  };

  function cleanText(value, fallback = "") {
    return String(value ?? fallback).trim();
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function isValidDateString(value) {
    if (!value || typeof value !== "string") return false;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function cleanDate(value) {
    const text = cleanText(value);
    return isValidDateString(text) ? text : "";
  }

  function todayDate(referenceDate = new Date()) {
    const date = new Date(referenceDate);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function parseDate(value) {
    if (!isValidDateString(value)) return null;
    const date = new Date(`${value}T00:00:00`);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function formatDate(date) {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
    return date.toISOString().slice(0, 10);
  }

  function addDays(dateString, days) {
    const date = parseDate(dateString);
    if (!date) return "";
    date.setDate(date.getDate() + Number(days || 0));
    return formatDate(date);
  }

  function daysBetween(dateString, referenceDate = new Date()) {
    const date = parseDate(dateString);
    if (!date) return null;
    const today = todayDate(referenceDate);
    return Math.round((date.getTime() - today.getTime()) / 86400000);
  }

  function normalizeStorageType(value, fallback = "pantry") {
    const clean = cleanText(value || fallback).toLowerCase();
    return STORAGE_TYPES.includes(clean) ? clean : fallback;
  }

  function normalizeName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function readOverrideStore() {
    try {
      const parsed = JSON.parse(global.localStorage?.getItem(OVERRIDE_STORE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ingredients: {}, dishes: {}, ...parsed }
        : { ingredients: {}, dishes: {} };
    } catch {
      return { ingredients: {}, dishes: {} };
    }
  }

  function overrideKeysFor(raw = {}) {
    const keys = [];
    if (raw.id) keys.push(`id:${raw.id}`);
    const name = normalizeName(raw.name || raw.nombre);
    if (name) keys.push(`name:${name}`);
    return keys;
  }

  function cleanOverride(value = {}) {
    return {
      expiryDate: cleanDate(value.expiryDate),
      openedDate: cleanDate(value.openedDate),
      preparedDate: cleanDate(value.preparedDate),
      frozenDate: cleanDate(value.frozenDate),
      storageType: value.storageType ? normalizeStorageType(value.storageType) : "",
      discardedDate: cleanDate(value.discardedDate),
      discardedQty: value.discardedQty,
      wasteReason: value.wasteReason
    };
  }

  function mergeLifecycleOverride(raw = {}, itemType = "ingredient") {
    const bucket = itemType === "dish" ? readOverrideStore().dishes : readOverrideStore().ingredients;
    const overrides = overrideKeysFor(raw)
      .map(key => bucket[key])
      .filter(Boolean)
      .map(cleanOverride)
      .reduce((merged, item) => ({ ...merged, ...Object.fromEntries(Object.entries(item).filter(([, value]) => value !== "" && value !== undefined && value !== null)) }), {});
    return { ...raw, ...overrides };
  }

  function normalizeLifecycle(raw = {}, defaults = {}) {
    return {
      expiryDate: cleanDate(raw.expiryDate || raw.caducidad || raw.bestBeforeDate || raw.fechaCaducidad || defaults.expiryDate),
      openedDate: cleanDate(raw.openedDate || raw.fechaApertura || defaults.openedDate),
      preparedDate: cleanDate(raw.preparedDate || raw.fechaPreparacion || raw.cookedDate || defaults.preparedDate),
      frozenDate: cleanDate(raw.frozenDate || raw.fechaCongelado || defaults.frozenDate),
      storageType: normalizeStorageType(raw.storageType || raw.conservacion || defaults.storageType, defaults.storageType || "pantry"),
      consumedDate: cleanDate(raw.consumedDate || raw.fechaConsumo || defaults.consumedDate),
      discardedDate: cleanDate(raw.discardedDate || raw.fechaDesperdicio || defaults.discardedDate),
      discardedQty: Math.max(0, numberOrZero(raw.discardedQty ?? raw.cantidadDesperdiciada ?? defaults.discardedQty)),
      wasteReason: cleanText(raw.wasteReason || raw.motivoDesperdicio || defaults.wasteReason)
    };
  }

  function normalizeIngredientStock(raw = {}) {
    const merged = mergeLifecycleOverride(raw, "ingredient");
    return {
      ...merged,
      qty: Math.max(0, numberOrZero(merged.qty ?? merged.cantidad)),
      unit: cleanText(merged.unit || merged.unidad || "unidades"),
      available: merged.available !== false && merged.disponible !== false,
      ...normalizeLifecycle(merged, { storageType: "pantry" })
    };
  }

  function normalizeDishStock(raw = {}) {
    const merged = mergeLifecycleOverride(raw, "dish");
    return {
      ...merged,
      qty: Math.max(0, numberOrZero(merged.qty ?? merged.racionesPreparadas ?? merged.stock)),
      unit: cleanText(merged.unit || merged.unidad || "raciones"),
      ...normalizeLifecycle(merged, { storageType: merged.frozenDate ? "freezer" : "fridge" })
    };
  }

  function hasStock(item) {
    return item.available === true || numberOrZero(item.qty ?? item.cantidad ?? item.stock ?? item.racionesPreparadas) > 0;
  }

  function hasAnyLifecycleDate(item) {
    return Boolean(item.expiryDate || item.openedDate || item.preparedDate || item.frozenDate || item.caducidad || item.fechaCaducidad || item.fechaApertura || item.fechaPreparacion || item.fechaCongelado);
  }

  function suggestExpiryDate(raw = {}, itemType = "ingredient", options = {}) {
    const item = itemType === "dish" ? normalizeDishStock(raw) : normalizeIngredientStock(raw);
    if (item.expiryDate) return item.expiryDate;

    const policy = {
      ingredient: { ...DEFAULT_LIFE_DAYS.ingredient, ...(options.ingredientLifeDays || {}) },
      dish: { ...DEFAULT_LIFE_DAYS.dish, ...(options.dishLifeDays || {}) }
    };

    if (item.frozenDate) return addDays(item.frozenDate, policy[itemType].freezer);
    if (itemType === "dish" && item.preparedDate) return addDays(item.preparedDate, policy.dish.prepared);
    if (itemType === "ingredient" && item.openedDate) return addDays(item.openedDate, policy.ingredient.opened);
    if (item.preparedDate) return addDays(item.preparedDate, policy[itemType].fridge);

    const storage = normalizeStorageType(item.storageType, itemType === "dish" ? "fridge" : "pantry");
    const baseDate = cleanDate(options.referenceDateString) || formatDate(todayDate(options.referenceDate || new Date()));
    return addDays(baseDate, policy[itemType][storage] || policy[itemType].fridge || 3);
  }

  function applySuggestedExpiryDates(data = {}, options = {}) {
    const overwrite = options.overwrite === true;
    return {
      ...data,
      ingredients: Array.isArray(data.ingredients)
        ? data.ingredients.map(item => {
            const normalized = normalizeIngredientStock(item);
            if (!normalized.expiryDate || overwrite) normalized.expiryDate = suggestExpiryDate(normalized, "ingredient", options);
            return normalized;
          })
        : [],
      dishes: Array.isArray(data.dishes)
        ? data.dishes.map(item => {
            const normalized = normalizeDishStock(item);
            if (!normalized.expiryDate || overwrite) normalized.expiryDate = suggestExpiryDate(normalized, "dish", options);
            return normalized;
          })
        : []
    };
  }

  function buildMissingDateAlerts({ ingredients = [], dishes = [] } = {}, options = {}) {
    if (options.includeMissingDates === false) return [];
    const alerts = [];

    ingredients.map(normalizeIngredientStock).forEach(item => {
      if (!hasStock(item) || hasAnyLifecycleDate(item)) return;
      alerts.push({
        severity: "missing-date",
        itemType: "Ingrediente",
        id: item.id || "",
        name: item.name || item.nombre || "Sin nombre",
        days: 9999,
        message: "Sin fecha de caducidad registrada",
        action: "Añadir caducidad, fecha de apertura o congelado para que pueda avisar a tiempo"
      });
    });

    dishes.map(normalizeDishStock).forEach(item => {
      if (!hasStock(item) || hasAnyLifecycleDate(item)) return;
      alerts.push({
        severity: "missing-date",
        itemType: "Plato",
        id: item.id || "",
        name: item.name || item.nombre || "Sin nombre",
        days: 9999,
        message: "Sin fecha de preparación o caducidad registrada",
        action: "Añadir fecha de preparación, caducidad o congelado"
      });
    });

    return alerts.sort((a, b) => a.name.localeCompare(b.name, "es"));
  }

  function buildExpiryAlerts({ ingredients = [], dishes = [] } = {}, options = {}) {
    const referenceDate = options.referenceDate || new Date();
    const soonDays = Number.isFinite(Number(options.soonDays)) ? Number(options.soonDays) : 3;
    const freezerWarningDays = Number.isFinite(Number(options.freezerWarningDays)) ? Number(options.freezerWarningDays) : 90;
    const alerts = [];

    function pushExpiryAlert(item, itemType) {
      const days = daysBetween(item.expiryDate, referenceDate);
      if (days === null) return;

      if (days < 0) {
        alerts.push({ severity: "expired", itemType, id: item.id || "", name: item.name || item.nombre || "Sin nombre", days, message: `Caducado hace ${Math.abs(days)} dia/s`, action: "Revisar y descartar si no es seguro" });
      } else if (days === 0) {
        alerts.push({ severity: "today", itemType, id: item.id || "", name: item.name || item.nombre || "Sin nombre", days, message: itemType === "Plato" ? "Consumir hoy" : "Caduca hoy", action: "Planificar hoy" });
      } else if (days <= soonDays) {
        alerts.push({ severity: "soon", itemType, id: item.id || "", name: item.name || item.nombre || "Sin nombre", days, message: itemType === "Plato" ? `Consumir en ${days} dia/s` : `Caduca en ${days} dia/s`, action: "Priorizar esta semana" });
      }
    }

    function pushFreezerAlert(item, itemType) {
      if (item.storageType !== "freezer" && !item.frozenDate) return;
      const daysSinceFrozen = daysBetween(item.frozenDate, referenceDate);
      if (daysSinceFrozen === null) return;
      const age = Math.abs(Math.min(daysSinceFrozen, 0));
      if (age >= freezerWarningDays) {
        alerts.push({ severity: "freezer", itemType, id: item.id || "", name: item.name || item.nombre || "Sin nombre", days: -age, message: `Congelado hace ${age} dia/s`, action: "Usar antes de seguir acumulando congelados" });
      }
    }

    ingredients.map(normalizeIngredientStock).forEach(item => {
      pushExpiryAlert(item, "Ingrediente");
      pushFreezerAlert(item, "Ingrediente");
    });

    dishes.map(normalizeDishStock).forEach(item => {
      pushExpiryAlert(item, "Plato");
      pushFreezerAlert(item, "Plato");
    });

    const severityWeight = { expired: 0, today: 1, soon: 2, freezer: 3, "missing-date": 4 };
    return [...alerts, ...buildMissingDateAlerts({ ingredients, dishes }, options)]
      .sort((a, b) => (severityWeight[a.severity] ?? 9) - (severityWeight[b.severity] ?? 9) || a.days - b.days || a.name.localeCompare(b.name, "es"));
  }

  function buildConsumptionRecommendations({ ingredients = [], dishes = [] } = {}, options = {}) {
    const alerts = buildExpiryAlerts({ ingredients, dishes }, options);
    const severityScore = { expired: 100, today: 80, soon: 60, freezer: 35, "missing-date": 20 };
    const recommendations = alerts.map(alert => ({
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
    }));

    return recommendations.sort((a, b) => b.priority - a.priority || a.days - b.days || a.name.localeCompare(b.name, "es"));
  }

  function calculateWasteScore({ ingredients = [], dishes = [] } = {}, options = {}) {
    const allItems = [
      ...ingredients.map(item => ({ ...normalizeIngredientStock(item), itemType: "Ingrediente" })),
      ...dishes.map(item => ({ ...normalizeDishStock(item), itemType: "Plato" }))
    ];

    const stockItems = allItems.filter(item => numberOrZero(item.qty) > 0 || item.available === true);
    const alertsWithoutMissing = buildExpiryAlerts({ ingredients, dishes }, { ...options, includeMissingDates: false });
    const alerts = buildExpiryAlerts({ ingredients, dishes }, options);
    const expiredCount = alertsWithoutMissing.filter(alert => alert.severity === "expired").length;
    const todayCount = alertsWithoutMissing.filter(alert => alert.severity === "today").length;
    const soonCount = alertsWithoutMissing.filter(alert => alert.severity === "soon").length;
    const freezerCount = alertsWithoutMissing.filter(alert => alert.severity === "freezer").length;
    const missingDateCount = alerts.filter(alert => alert.severity === "missing-date").length;
    const discardedQty = allItems.reduce((total, item) => total + numberOrZero(item.discardedQty), 0);

    const possible = Math.max(1, stockItems.length);
    const riskPenalty = Math.min(70, expiredCount * 18 + todayCount * 10 + soonCount * 5 + freezerCount * 3);
    const missingPenalty = Math.min(15, missingDateCount * 2);
    const wastePenalty = Math.min(30, discardedQty * 2);
    const score = Math.max(0, Math.min(100, Math.round(100 - riskPenalty - missingPenalty - wastePenalty)));

    let label = "Excelente";
    if (score < 40) label = "Alto riesgo de desperdicio";
    else if (score < 70) label = "Mejorable";
    else if (score < 90) label = "Bueno";

    return { score, label, stockItems: possible, expiredCount, todayCount, soonCount, freezerCount, missingDateCount, discardedQty, alerts, recommendations: buildConsumptionRecommendations({ ingredients, dishes }, options) };
  }

  function migrateStockDatabase(data = {}) {
    return {
      ...data,
      app: data.app || "gestor-comidas",
      version: Math.max(3, Number(data.version) || 0),
      ingredientFamilies: Array.isArray(data.ingredientFamilies) ? data.ingredientFamilies : [],
      ingredients: Array.isArray(data.ingredients) ? data.ingredients.map(normalizeIngredientStock) : [],
      dishPacks: Array.isArray(data.dishPacks) ? data.dishPacks : [],
      dishes: Array.isArray(data.dishes) ? data.dishes.map(normalizeDishStock) : [],
      favoriteIds: Array.isArray(data.favoriteIds) ? data.favoriteIds : [],
      familyMembers: Array.isArray(data.familyMembers) ? data.familyMembers : [{ id: "default", name: "Todos" }],
      mealTypes: Array.isArray(data.mealTypes) ? data.mealTypes : [{ id: "lunch", name: "Comida" }, { id: "dinner", name: "Cena" }],
      weeks: Array.isArray(data.weeks) ? data.weeks : [],
      typicalWeekPlan: data.typicalWeekPlan || null
    };
  }

  function runSelfTests() {
    const sample = migrateStockDatabase({
      version: 2,
      ingredients: [
        { name: "Yogur", qty: 2, unit: "unidades", expiryDate: "2026-06-04", available: true },
        { name: "Arroz", qty: 1, unit: "kg", expiryDate: "fecha mala", available: true },
        { name: "Pollo", qty: 1, unit: "kg", frozenDate: "2026-01-01", storageType: "freezer" },
        { name: "Leche abierta", qty: 1, unit: "l", openedDate: "2026-06-02", storageType: "fridge" },
        { name: "Sin fecha", qty: 1, unit: "unidad", available: true }
      ],
      dishes: [
        { name: "Salmorejo", qty: 3, unit: "raciones", preparedDate: "2026-06-01", expiryDate: "2026-06-03" },
        { name: "Lentejas", qty: 2, unit: "raciones", preparedDate: "2026-06-01", storageType: "fridge" },
        { name: "Plato sin fecha", qty: 1, unit: "raciones" }
      ]
    });

    const enriched = applySuggestedExpiryDates(sample, { referenceDate: new Date("2026-06-03T12:00:00") });
    const result = calculateWasteScore(sample, { referenceDate: new Date("2026-06-03T12:00:00"), soonDays: 3, freezerWarningDays: 90 });
    const assertions = [
      [sample.version === 3, "migrateStockDatabase bumps version to 3"],
      [sample.ingredients[1].expiryDate === "", "invalid dates are cleaned"],
      [enriched.ingredients[3].expiryDate === "2026-06-06", "opened ingredients receive suggested expiry"],
      [enriched.dishes[1].expiryDate === "2026-06-04", "prepared dishes receive suggested expiry"],
      [result.todayCount === 1, "dish expiring today is counted"],
      [result.soonCount >= 1, "items expiring soon are counted"],
      [result.freezerCount === 1, "old frozen stock is counted"],
      [result.missingDateCount === 2, "items without dates are counted"],
      [result.score < 100, "risk lowers the waste score"],
      [result.recommendations.length >= 4, "recommendations are created from alerts"]
    ];
    return assertions.map(([ok, message]) => ({ ok, message }));
  }

  global.StockLifecycle = {
    STORAGE_TYPES,
    DATE_FIELDS,
    DEFAULT_LIFE_DAYS,
    OVERRIDE_STORE_KEY,
    cleanDate,
    daysBetween,
    addDays,
    normalizeLifecycle,
    normalizeIngredientStock,
    normalizeDishStock,
    mergeLifecycleOverride,
    suggestExpiryDate,
    applySuggestedExpiryDates,
    buildMissingDateAlerts,
    buildExpiryAlerts,
    buildConsumptionRecommendations,
    calculateWasteScore,
    migrateStockDatabase,
    runSelfTests
  };
})(typeof window !== "undefined" ? window : globalThis);
