/*
 * Lifecycle form bridge for PlanificadorComidas.
 * Ensures ingredient and dish lifecycle dates are captured from index.html forms.
 * It also merges pending lifecycle values into localStorage writes so the main
 * monolithic index state cannot accidentally overwrite them.
 */
(function attachLifecycleFormBridge(global) {
  "use strict";

  const pendingIngredient = { values: null };
  const pendingDish = { values: null };
  let storagePatched = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function cleanDate(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const date = new Date(`${text}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "" : text;
  }

  function storageType(value, fallback = "fridge") {
    const text = String(value || fallback).trim().toLowerCase();
    return ["pantry", "fridge", "freezer"].includes(text) ? text : fallback;
  }

  function parseArray(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveArray(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function parseArrayText(value) {
    try {
      const parsed = JSON.parse(String(value || "[]"));
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }

  function insertAfter(reference, node) {
    if (!reference || !reference.parentElement || !node) return false;
    reference.parentElement.insertBefore(node, reference.nextSibling);
    return true;
  }

  function ensureIngredientFields() {
    if (byId("ingredientExpiryDate")) return;
    const productsBox = byId("ingredientProducts")?.closest(".scanner-box") || byId("ingredientApproxPrice");
    const wrapper = document.createElement("div");
    wrapper.className = "row";
    wrapper.innerHTML = `
      <div>
        <label for="ingredientExpiryDate">Caducidad / consumo preferente</label>
        <input id="ingredientExpiryDate" type="date" />
        <div class="help">Opcional. Se usa para avisos de consumo.</div>
      </div>
      <div>
        <label for="ingredientStorageType">Conservación</label>
        <select id="ingredientStorageType">
          <option value="pantry">Despensa</option>
          <option value="fridge">Nevera</option>
          <option value="freezer">Congelador</option>
        </select>
        <div class="help">Ayuda a calcular sugerencias.</div>
      </div>`;
    insertAfter(productsBox, wrapper);
  }

  function ensureDishFields() {
    if (byId("dishPreparedDate") || byId("dishExpiryDate")) return;
    const priceInput = byId("dishApproxPrice");
    const wrapper = document.createElement("div");
    wrapper.id = "dishLifecycleFields";
    wrapper.innerHTML = `
      <div class="row">
        <div>
          <label for="dishPreparedDate">Fecha de preparación</label>
          <input id="dishPreparedDate" type="date" />
          <div class="help">Cuándo se cocinó o preparó el plato.</div>
        </div>
        <div>
          <label for="dishExpiryDate">Caducidad / consumir antes de</label>
          <input id="dishExpiryDate" type="date" />
          <div class="help">Fecha límite recomendada de consumo.</div>
        </div>
      </div>
      <div class="row">
        <div>
          <label for="dishFrozenDate">Fecha de congelado</label>
          <input id="dishFrozenDate" type="date" />
        </div>
        <div>
          <label for="dishStorageType">Conservación</label>
          <select id="dishStorageType">
            <option value="fridge">Nevera</option>
            <option value="freezer">Congelador</option>
            <option value="pantry">Despensa</option>
          </select>
        </div>
      </div>`;
    insertAfter(priceInput, wrapper);
  }

  function readIngredientFormValues() {
    return {
      editingId: byId("editingIngredientId")?.value || "",
      name: byId("ingredientName")?.value.trim() || "",
      expiryDate: cleanDate(byId("ingredientExpiryDate")?.value),
      storageType: storageType(byId("ingredientStorageType")?.value, "pantry")
    };
  }

  function readDishFormValues() {
    const frozenDate = cleanDate(byId("dishFrozenDate")?.value);
    return {
      editingId: byId("editingDishId")?.value || "",
      name: byId("dishName")?.value.trim() || "",
      preparedDate: cleanDate(byId("dishPreparedDate")?.value),
      expiryDate: cleanDate(byId("dishExpiryDate")?.value),
      frozenDate,
      storageType: storageType(byId("dishStorageType")?.value, frozenDate ? "freezer" : "fridge")
    };
  }

  function findLastByName(list, name) {
    const clean = String(name || "").trim().toLocaleLowerCase("es");
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const itemName = String(list[index]?.name || list[index]?.nombre || "").trim().toLocaleLowerCase("es");
      if (itemName === clean) return list[index];
    }
    return null;
  }

  function findTarget(list, values) {
    if (!Array.isArray(list) || !values) return null;
    if (values.editingId) {
      const byIdMatch = list.find(entry => entry && entry.id === values.editingId);
      if (byIdMatch) return byIdMatch;
    }
    return findLastByName(list, values.name);
  }

  function mergeIngredientLifecycle(list, values) {
    if (!values || (!values.expiryDate && !values.storageType)) return list;
    const item = findTarget(list, values);
    if (!item) return list;
    item.expiryDate = values.expiryDate || item.expiryDate || "";
    item.storageType = values.storageType || item.storageType || "pantry";
    return list;
  }

  function mergeDishLifecycle(list, values) {
    if (!values || (!values.preparedDate && !values.expiryDate && !values.frozenDate && !values.storageType)) return list;
    const item = findTarget(list, values);
    if (!item) return list;
    item.preparedDate = values.preparedDate || item.preparedDate || "";
    item.expiryDate = values.expiryDate || item.expiryDate || "";
    item.frozenDate = values.frozenDate || item.frozenDate || "";
    item.storageType = values.storageType || item.storageType || (values.frozenDate ? "freezer" : "fridge");
    return list;
  }

  function applyIngredientLifecycle(values) {
    const list = parseArray("ingredients");
    mergeIngredientLifecycle(list, values);
    saveArray("ingredients", list);
  }

  function applyDishLifecycle(values) {
    const list = parseArray("dishes");
    mergeDishLifecycle(list, values);
    saveArray("dishes", list);
  }

  function patchLocalStorageWrites() {
    if (storagePatched || !global.localStorage) return;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      try {
        if (key === "ingredients" && pendingIngredient.values) {
          const list = parseArrayText(value);
          if (list) value = JSON.stringify(mergeIngredientLifecycle(list, pendingIngredient.values));
        }
        if (key === "dishes" && pendingDish.values) {
          const list = parseArrayText(value);
          if (list) value = JSON.stringify(mergeDishLifecycle(list, pendingDish.values));
        }
      } catch (error) {
        console.warn("No se pudo fusionar fechas de caducidad antes de guardar", error);
      }
      return originalSetItem.call(this, key, value);
    };
    storagePatched = true;
  }

  function scheduleApply(kind) {
    const values = kind === "ingredient" ? pendingIngredient.values : pendingDish.values;
    const apply = kind === "ingredient" ? applyIngredientLifecycle : applyDishLifecycle;
    [0, 50, 250, 800, 1600].forEach(delay => setTimeout(() => apply(values), delay));
  }

  function fillIngredientFormFromStorage() {
    const editingId = byId("editingIngredientId")?.value || "";
    if (!editingId) return;
    const item = parseArray("ingredients").find(entry => entry && entry.id === editingId);
    if (!item) return;
    const expiry = byId("ingredientExpiryDate");
    const storage = byId("ingredientStorageType");
    if (expiry) expiry.value = item.expiryDate || "";
    if (storage) storage.value = storageType(item.storageType, item.frozenDate ? "freezer" : "pantry");
  }

  function fillDishFormFromStorage() {
    const editingId = byId("editingDishId")?.value || "";
    if (!editingId) return;
    const item = parseArray("dishes").find(entry => entry && entry.id === editingId);
    if (!item) return;
    const prepared = byId("dishPreparedDate");
    const expiry = byId("dishExpiryDate");
    const frozen = byId("dishFrozenDate");
    const storage = byId("dishStorageType");
    if (prepared) prepared.value = item.preparedDate || "";
    if (expiry) expiry.value = item.expiryDate || "";
    if (frozen) frozen.value = item.frozenDate || "";
    if (storage) storage.value = storageType(item.storageType, item.frozenDate ? "freezer" : "fridge");
  }

  function clearDishFormLifecycle() {
    ["dishPreparedDate", "dishExpiryDate", "dishFrozenDate"].forEach(id => {
      const input = byId(id);
      if (input) input.value = "";
    });
    const storage = byId("dishStorageType");
    if (storage) storage.value = "fridge";
  }

  function install() {
    ensureIngredientFields();
    ensureDishFields();
    patchLocalStorageWrites();

    const saveIngredient = byId("saveIngredientBtn");
    if (saveIngredient && saveIngredient.dataset.lifecycleBridge !== "true") {
      saveIngredient.dataset.lifecycleBridge = "true";
      saveIngredient.addEventListener("click", () => {
        pendingIngredient.values = readIngredientFormValues();
        scheduleApply("ingredient");
      }, true);
    }

    const saveDish = byId("saveDishBtn");
    if (saveDish && saveDish.dataset.lifecycleBridge !== "true") {
      saveDish.dataset.lifecycleBridge = "true";
      saveDish.addEventListener("click", () => {
        pendingDish.values = readDishFormValues();
        scheduleApply("dish");
      }, true);
    }

    byId("cancelDishEditBtn")?.addEventListener("click", () => setTimeout(clearDishFormLifecycle, 0));

    document.addEventListener("click", event => {
      const editButton = event.target.closest("button");
      if (!editButton) return;
      if (!/Editar/.test(editButton.textContent || "")) return;
      setTimeout(() => {
        fillIngredientFormFromStorage();
        fillDishFormFromStorage();
      }, 80);
    }, true);

    const frozen = byId("dishFrozenDate");
    frozen?.addEventListener("change", () => {
      const storage = byId("dishStorageType");
      if (storage && frozen.value) storage.value = "freezer";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
  document.addEventListener?.("planificador:modules-ready", install);
  setTimeout(install, 500);

  global.LifecycleFormBridge = {
    install,
    applyIngredientLifecycle,
    applyDishLifecycle,
    mergeIngredientLifecycle,
    mergeDishLifecycle
  };
})(typeof window !== "undefined" ? window : globalThis);
