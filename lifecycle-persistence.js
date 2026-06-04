/*
 * Lifecycle persistence for PlanificadorComidas.
 * Keeps expiry/preparation/freezing fields in a small side-store and merges them
 * into ingredients/dishes so cached index versions and caducidades.html see the same dates.
 */
(function attachLifecyclePersistence(global) {
  "use strict";

  const STORE_KEY = "planificadorLifecycleOverrides";

  function byId(id) {
    return document.getElementById(id);
  }

  function cleanDate(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const date = new Date(`${text}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "" : text;
  }

  function storageType(value, fallback = "pantry") {
    const text = String(value || fallback).trim().toLowerCase();
    return ["pantry", "fridge", "freezer"].includes(text) ? text : fallback;
  }

  function normalizeName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function readStore() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? { ingredients: {}, dishes: {}, ...parsed }
        : { ingredients: {}, dishes: {} };
    } catch {
      return { ingredients: {}, dishes: {} };
    }
  }

  function writeStore(store) {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ingredients: {}, dishes: {}, ...store }));
  }

  function readArray(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function writeArray(key, items) {
    localStorage.setItem(key, JSON.stringify(items));
  }

  function keysForItem(item) {
    const keys = [];
    if (item?.id) keys.push(`id:${item.id}`);
    const name = normalizeName(item?.name || item?.nombre);
    if (name) keys.push(`name:${name}`);
    return keys;
  }

  function upsertOverride(type, item, values) {
    const store = readStore();
    const bucket = type === "dish" ? store.dishes : store.ingredients;
    const cleanValues = Object.fromEntries(Object.entries(values || {}).filter(([, value]) => value !== undefined && value !== null && value !== ""));
    if (!Object.keys(cleanValues).length) return;
    keysForItem(item).forEach(key => {
      bucket[key] = { ...(bucket[key] || {}), ...cleanValues, updatedAt: new Date().toISOString() };
    });
    writeStore(store);
  }

  function findTarget(items, values) {
    if (!Array.isArray(items)) return null;
    if (values.id) {
      const byId = items.find(item => item && item.id === values.id);
      if (byId) return byId;
    }
    const wantedName = normalizeName(values.name);
    if (!wantedName) return null;
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const itemName = normalizeName(items[index]?.name || items[index]?.nombre);
      if (itemName === wantedName) return items[index];
    }
    return null;
  }

  function applyValuesToItem(item, values, type) {
    if (!item || !values) return item;
    if (values.expiryDate) item.expiryDate = values.expiryDate;
    if (values.openedDate) item.openedDate = values.openedDate;
    if (values.preparedDate) item.preparedDate = values.preparedDate;
    if (values.frozenDate) item.frozenDate = values.frozenDate;
    if (values.storageType) item.storageType = values.storageType;
    if (!item.storageType) item.storageType = type === "dish" ? "fridge" : "pantry";
    return item;
  }

  function mergeOverridesIntoList(type, items) {
    const store = readStore();
    const bucket = type === "dish" ? store.dishes : store.ingredients;
    return (Array.isArray(items) ? items : []).map(item => {
      const merged = { ...item };
      keysForItem(merged).forEach(key => applyValuesToItem(merged, bucket[key], type));
      return merged;
    });
  }

  function reconcileLocalStorage() {
    const ingredients = mergeOverridesIntoList("ingredient", readArray("ingredients"));
    const dishes = mergeOverridesIntoList("dish", readArray("dishes"));
    writeArray("ingredients", ingredients);
    writeArray("dishes", dishes);
    return { ingredients, dishes };
  }

  function captureIngredientForm() {
    const values = {
      id: byId("editingIngredientId")?.value || "",
      name: byId("ingredientName")?.value.trim() || "",
      expiryDate: cleanDate(byId("ingredientExpiryDate")?.value),
      storageType: storageType(byId("ingredientStorageType")?.value, "pantry")
    };
    if (!values.name && !values.id) return;
    upsertOverride("ingredient", { id: values.id, name: values.name }, values);
    setTimeout(reconcileLocalStorage, 0);
    setTimeout(reconcileLocalStorage, 200);
    setTimeout(reconcileLocalStorage, 1000);
  }

  function captureDishForm() {
    const frozenDate = cleanDate(byId("dishFrozenDate")?.value);
    const values = {
      id: byId("editingDishId")?.value || "",
      name: byId("dishName")?.value.trim() || "",
      preparedDate: cleanDate(byId("dishPreparedDate")?.value),
      expiryDate: cleanDate(byId("dishExpiryDate")?.value),
      frozenDate,
      storageType: storageType(byId("dishStorageType")?.value, frozenDate ? "freezer" : "fridge")
    };
    if (!values.name && !values.id) return;
    upsertOverride("dish", { id: values.id, name: values.name }, values);
    setTimeout(reconcileLocalStorage, 0);
    setTimeout(reconcileLocalStorage, 200);
    setTimeout(reconcileLocalStorage, 1000);
  }

  function patchLocalStorageWrites() {
    if (Storage.prototype.__planificadorLifecyclePersistencePatched) return;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      if (key === "ingredients" || key === "dishes") {
        try {
          const parsed = JSON.parse(String(value || "[]"));
          if (Array.isArray(parsed)) {
            value = JSON.stringify(mergeOverridesIntoList(key === "dishes" ? "dish" : "ingredient", parsed));
          }
        } catch {
          // Preserve original value if it is not valid JSON.
        }
      }
      return originalSetItem.call(this, key, value);
    };
    Storage.prototype.__planificadorLifecyclePersistencePatched = true;
  }

  function installFormCapture() {
    patchLocalStorageWrites();
    byId("saveIngredientBtn")?.addEventListener("click", captureIngredientForm, true);
    byId("saveDishBtn")?.addEventListener("click", captureDishForm, true);
    byId("ingredientExpiryDate")?.addEventListener("change", captureIngredientForm, true);
    byId("ingredientStorageType")?.addEventListener("change", captureIngredientForm, true);
    byId("dishPreparedDate")?.addEventListener("change", captureDishForm, true);
    byId("dishExpiryDate")?.addEventListener("change", captureDishForm, true);
    byId("dishFrozenDate")?.addEventListener("change", captureDishForm, true);
    byId("dishStorageType")?.addEventListener("change", captureDishForm, true);
    reconcileLocalStorage();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installFormCapture);
  else installFormCapture();
  document.addEventListener?.("planificador:modules-ready", installFormCapture);

  global.LifecyclePersistence = {
    STORE_KEY,
    readStore,
    writeStore,
    upsertOverride,
    mergeOverridesIntoList,
    reconcileLocalStorage,
    captureIngredientForm,
    captureDishForm
  };
})(typeof window !== "undefined" ? window : globalThis);
