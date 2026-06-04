/*
 * Independent expiry core for PlanificadorComidas.
 * Single source of truth for expiry dashboard: localStorage.ingredients and localStorage.dishes.
 * This module does not depend on index.html functions.
 */
(function attachExpiryCore(global) {
  "use strict";

  const DAY_MS = 86400000;
  const STORAGE_KEYS = { ingredients: "ingredients", dishes: "dishes" };

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function cleanDate(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const date = new Date(`${text}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "" : text;
  }

  function todayString(date = new Date()) {
    return new Date(date).toISOString().slice(0, 10);
  }

  function parseArray(key) {
    try {
      const parsed = JSON.parse(global.localStorage?.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveArray(key, value) {
    global.localStorage?.setItem(key, JSON.stringify(Array.isArray(value) ? value : []));
  }

  function normalizeUnit(unit) {
    const clean = String(unit || "").trim().toLowerCase();
    const aliases = {
      gr: "g", gramo: "g", gramos: "g",
      kilo: "kg", kilos: "kg",
      litro: "l", litros: "l",
      mililitro: "ml", mililitros: "ml",
      ud: "unidades", uds: "unidades", u: "unidades", unidad: "unidades", pieza: "unidades", piezas: "unidades",
      racion: "unidades", raciones: "unidades"
    };
    return aliases[clean] || clean || "unidades";
  }

  function daysUntil(dateText, referenceDate = new Date()) {
    const clean = cleanDate(dateText);
    if (!clean) return null;
    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);
    const target = new Date(`${clean}T00:00:00`);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / DAY_MS);
  }

  function normalizeIngredient(item = {}, index = 0) {
    return {
      ...item,
      id: item.id || `ingredient-${index}`,
      name: item.name || item.nombre || "Sin nombre",
      qty: numberOrZero(item.qty ?? item.cantidad),
      unit: normalizeUnit(item.unit || item.unidad),
      unitWeightG: numberOrZero(item.unitWeightG ?? item.pesoUnidadG ?? item.weightPerUnitG),
      available: item.available !== false && item.disponible !== false,
      expiryDate: cleanDate(item.expiryDate || item.caducidad || item.bestBeforeDate || item.fechaCaducidad),
      discardedQty: numberOrZero(item.discardedQty ?? item.cantidadDesperdiciada),
      discardedDate: cleanDate(item.discardedDate || item.fechaDesperdicio),
      consumedDate: cleanDate(item.consumedDate || item.fechaConsumo),
      wasteReason: item.wasteReason || item.motivoDesperdicio || "",
      itemType: "Ingrediente",
      storageKey: STORAGE_KEYS.ingredients
    };
  }

  function normalizeDish(item = {}, index = 0) {
    return {
      ...item,
      id: item.id || `dish-${index}`,
      name: item.name || item.nombre || "Sin nombre",
      qty: numberOrZero(item.qty ?? item.racionesPreparadas ?? item.stock),
      unit: normalizeUnit(item.unit || item.unidad || "unidades"),
      unitWeightG: numberOrZero(item.unitWeightG ?? item.pesoUnidadG ?? item.weightPerUnitG),
      preparedDate: cleanDate(item.preparedDate || item.fechaPreparacion || item.cookedDate),
      expiryDate: cleanDate(item.expiryDate || item.caducidad || item.bestBeforeDate || item.fechaCaducidad),
      discardedQty: numberOrZero(item.discardedQty ?? item.cantidadDesperdiciada),
      discardedDate: cleanDate(item.discardedDate || item.fechaDesperdicio),
      consumedDate: cleanDate(item.consumedDate || item.fechaConsumo),
      wasteReason: item.wasteReason || item.motivoDesperdicio || "",
      itemType: "Plato",
      storageKey: STORAGE_KEYS.dishes
    };
  }

  function loadState() {
    const rawIngredients = parseArray(STORAGE_KEYS.ingredients);
    const rawDishes = parseArray(STORAGE_KEYS.dishes);
    return {
      rawIngredients,
      rawDishes,
      ingredients: rawIngredients.map(normalizeIngredient),
      dishes: rawDishes.map(normalizeDish)
    };
  }

  function hasActiveStock(item) {
    if (item.consumedDate || item.discardedDate) return false;
    if (item.itemType === "Ingrediente") return item.available !== false && item.qty > 0;
    return item.qty > 0;
  }

  function buildAlerts(state = loadState(), options = {}) {
    const soonDays = Number.isFinite(Number(options.soonDays)) ? Number(options.soonDays) : 7;
    const referenceDate = options.referenceDate || new Date();
    const alerts = [];

    [...state.ingredients, ...state.dishes].forEach(item => {
      if (!hasActiveStock(item)) return;
      const days = daysUntil(item.expiryDate, referenceDate);
      const base = {
        id: item.id,
        storageKey: item.storageKey,
        itemType: item.itemType,
        name: item.name,
        qty: item.qty,
        unit: item.unit,
        days
      };

      if (days === null) {
        alerts.push({ ...base, severity: "missing-date", days: 9999, message: "Sin fecha de caducidad registrada", action: "Añade la fecha desde la pantalla principal" });
      } else if (days < 0) {
        alerts.push({ ...base, severity: "expired", message: `Caducado hace ${Math.abs(days)} día/s`, action: "Marca si se ha tirado o utilizado" });
      } else if (days === 0) {
        alerts.push({ ...base, severity: "today", message: "Caduca hoy", action: "Consumir hoy" });
      } else if (days <= soonDays) {
        alerts.push({ ...base, severity: "soon", message: `Caduca en ${days} día/s`, action: "Priorizar esta semana" });
      }
    });

    const weight = { expired: 0, today: 1, soon: 2, "missing-date": 3 };
    return alerts.sort((a, b) => (weight[a.severity] ?? 9) - (weight[b.severity] ?? 9) || a.days - b.days || a.name.localeCompare(b.name, "es"));
  }

  function updateItem(storageKey, id, updater) {
    const items = parseArray(storageKey);
    const index = items.findIndex(item => String(item.id) === String(id));
    if (index < 0) return null;
    const current = { ...items[index] };
    const updated = updater(current) || current;
    items[index] = updated;
    saveArray(storageKey, items);
    return updated;
  }

  function resolveExpired(storageKey, id, mode) {
    return updateItem(storageKey, id, item => {
      const qty = numberOrZero(item.qty ?? item.cantidad ?? item.stock ?? item.racionesPreparadas);
      if (mode === "discard") {
        item.discardedQty = qty;
        item.discardedDate = todayString();
        item.wasteReason = "Caducado";
        item.consumedDate = "";
      } else if (mode === "consume") {
        item.consumedDate = todayString();
        item.discardedQty = 0;
        item.discardedDate = "";
        item.wasteReason = "";
      }
      item.qty = 0;
      item.cantidad = undefined;
      item.stock = undefined;
      item.racionesPreparadas = undefined;
      if (storageKey === STORAGE_KEYS.ingredients) item.available = false;
      return item;
    });
  }

  function summary(state = loadState(), options = {}) {
    const alerts = buildAlerts(state, options);
    return {
      alerts,
      expired: alerts.filter(item => item.severity === "expired").length,
      today: alerts.filter(item => item.severity === "today").length,
      soon: alerts.filter(item => item.severity === "soon").length,
      missing: alerts.filter(item => item.severity === "missing-date").length,
      ingredients: state.ingredients.length,
      dishes: state.dishes.length
    };
  }

  global.ExpiryCore = {
    STORAGE_KEYS,
    cleanDate,
    todayString,
    normalizeUnit,
    daysUntil,
    normalizeIngredient,
    normalizeDish,
    loadState,
    hasActiveStock,
    buildAlerts,
    updateItem,
    resolveExpired,
    summary
  };
})(typeof window !== "undefined" ? window : globalThis);
