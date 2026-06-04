/*
 * Import/export helpers for PlanificadorComidas.
 * Uses PlanificadorDataStore when available to validate and normalize payloads.
 */
(function attachImportExport(global) {
  "use strict";

  const MAX_IMPORT_BYTES = 1_000_000;

  function getStore() {
    if (!global.PlanificadorDataStore) {
      throw new Error("PlanificadorDataStore no esta cargado.");
    }
    return global.PlanificadorDataStore;
  }

  function safeJsonParse(text, maxBytes = MAX_IMPORT_BYTES) {
    const raw = String(text || "").trim();
    if (!raw) throw new Error("No hay JSON para importar.");
    if (raw.length > maxBytes) throw new Error("El JSON es demasiado grande para importarlo de forma segura.");
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("El JSON no es valido.");
    }
  }

  function extractArrayPayload(data, keys) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
      for (const key of keys) {
        if (Array.isArray(data[key])) return data[key];
      }
    }
    return null;
  }

  function normalizeImportPayload(data, mode = "backup") {
    const store = getStore();
    if (mode === "ingredients") {
      const items = extractArrayPayload(data, ["ingredients", "ingredientes"]);
      if (!items) throw new Error("No encuentro una lista de ingredientes.");
      return items.map(store.normalizeIngredient).filter(Boolean);
    }

    if (mode === "dishes") {
      const items = extractArrayPayload(data, ["dishes", "platos", "recipes", "recetas"]);
      if (!items) throw new Error("No encuentro una lista de platos.");
      return items.map(store.normalizeDish).filter(Boolean);
    }

    return store.normalizeBackup(data);
  }

  function validateImportText(text, mode = "backup") {
    const parsed = safeJsonParse(text);
    const normalized = normalizeImportPayload(parsed, mode);
    return {
      parsed,
      normalized,
      json: JSON.stringify(normalized, null, 2),
      summary: summarizePayload(normalized, mode)
    };
  }

  function summarizePayload(payload, mode = "backup") {
    if (mode === "ingredients") {
      return {
        mode,
        ingredients: Array.isArray(payload) ? payload.length : 0
      };
    }
    if (mode === "dishes") {
      return {
        mode,
        dishes: Array.isArray(payload) ? payload.length : 0
      };
    }
    return {
      mode: "backup",
      ingredients: payload.ingredients?.length || 0,
      dishes: payload.dishes?.length || 0,
      weeks: payload.weeks?.length || 0,
      familyMembers: payload.familyMembers?.length || 0,
      mealTypes: payload.mealTypes?.length || 0,
      stockLots: (payload.ingredients || []).reduce((sum, item) => sum + (Array.isArray(item.stockLots) ? item.stockLots.length : 0), 0)
    };
  }

  function buildBackupFromState(state) {
    const store = getStore();
    return store.buildBackup(state);
  }

  function downloadJson(filename, data) {
    const json = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function copyJson(data) {
    const json = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    if (!navigator.clipboard) throw new Error("El portapapeles no esta disponible.");
    await navigator.clipboard.writeText(json);
    return json;
  }

  function filename(prefix = "gestor-comidas", date = new Date()) {
    return `${prefix}-${date.toISOString().slice(0, 10)}.json`;
  }

  function runSelfTests() {
    const sample = {
      app: "gestor-comidas",
      version: 1,
      ingredients: [{ name: "Tomate", qty: "500", unit: "g", stockLots: [{ qty: 200, unit: "g", expiryDate: "2026-06-05" }] }],
      dishes: [{ name: "Pasta", ingredients: [{ name: "Tomate", qty: "150", unit: "g" }] }]
    };
    const backup = normalizeImportPayload(sample, "backup");
    const ingredients = normalizeImportPayload(sample, "ingredients");
    const dishes = normalizeImportPayload(sample, "dishes");
    const assertions = [
      [backup.version >= 4, "backup import is migrated"],
      [backup.ingredients[0].stockLots.length === 1, "stock lots are kept"],
      [ingredients.length === 1, "ingredients mode extracts ingredients"],
      [dishes.length === 1, "dishes mode extracts dishes"],
      [validateImportText(JSON.stringify(sample), "backup").summary.ingredients === 1, "validation returns summary"]
    ];
    return assertions.map(([ok, message]) => ({ ok, message }));
  }

  global.PlanificadorImportExport = {
    MAX_IMPORT_BYTES,
    safeJsonParse,
    extractArrayPayload,
    normalizeImportPayload,
    validateImportText,
    summarizePayload,
    buildBackupFromState,
    downloadJson,
    copyJson,
    filename,
    runSelfTests
  };
})(typeof window !== "undefined" ? window : globalThis);
