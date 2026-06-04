/*
 * Unit normalization bridge for PlanificadorComidas.
 * Replaces the free-text ingredient unit field with a closed selector and only
 * shows unitWeightG when the selected unit is "unidades".
 */
(function attachUnitNormalization(global) {
  "use strict";

  const ALLOWED_UNITS = [
    { value: "g", label: "g" },
    { value: "kg", label: "kg" },
    { value: "ml", label: "ml" },
    { value: "l", label: "l" },
    { value: "unidades", label: "unidades" }
  ];

  const UNIT_ALIASES = {
    gr: "g",
    gramo: "g",
    gramos: "g",
    kilo: "kg",
    kilos: "kg",
    litro: "l",
    litros: "l",
    mililitro: "ml",
    mililitros: "ml",
    ud: "unidades",
    uds: "unidades",
    u: "unidades",
    unidad: "unidades",
    pieza: "unidades",
    piezas: "unidades",
    racion: "unidades",
    raciones: "unidades"
  };

  let pendingIngredientUnitWeight = null;
  let storagePatched = false;

  function byId(id) {
    return document.getElementById(id);
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  }

  function normalizeName(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  function normalizeUnit(unit) {
    const clean = String(unit || "").trim().toLowerCase();
    const normalized = UNIT_ALIASES[clean] || clean;
    return ALLOWED_UNITS.some(item => item.value === normalized) ? normalized : "unidades";
  }

  function isUnitBased(unit) {
    return normalizeUnit(unit) === "unidades";
  }

  function insertAfter(reference, node) {
    if (!reference || !reference.parentElement || !node) return false;
    reference.parentElement.insertBefore(node, reference.nextSibling);
    return true;
  }

  function replaceUnitInputWithSelect() {
    const current = byId("ingredientUnit");
    if (!current || current.tagName === "SELECT") return;

    const select = document.createElement("select");
    select.id = "ingredientUnit";
    select.innerHTML = ALLOWED_UNITS
      .map(unit => `<option value="${unit.value}">${unit.label}</option>`)
      .join("");
    select.value = normalizeUnit(current.value || "unidades");
    current.replaceWith(select);
  }

  function ensureUnitWeightField() {
    if (byId("ingredientUnitWeightG")) return;
    const unitInput = byId("ingredientUnit");
    if (!unitInput) return;
    const wrapper = document.createElement("div");
    wrapper.id = "ingredientUnitWeightGWrapper";
    wrapper.innerHTML = `
      <label for="ingredientUnitWeightG">Peso por unidad (g)</label>
      <input id="ingredientUnitWeightG" type="number" min="0" step="1" placeholder="Ej. 180" />
      <div class="help">Solo para unidad: 1 manzana = 180 g, 1 yogur = 125 g, 1 huevo = 60 g.</div>`;
    insertAfter(unitInput.closest(".row") || unitInput, wrapper);
  }

  function updateUnitWeightVisibility() {
    const wrapper = byId("ingredientUnitWeightGWrapper");
    const unit = byId("ingredientUnit")?.value || "";
    if (!wrapper) return;
    const visible = isUnitBased(unit);
    wrapper.style.display = visible ? "block" : "none";
    if (!visible) {
      const field = byId("ingredientUnitWeightG");
      if (field) field.value = "";
    }
  }

  function readPendingIngredient() {
    const unit = normalizeUnit(byId("ingredientUnit")?.value || "unidades");
    return {
      id: byId("editingIngredientId")?.value || "",
      name: byId("ingredientName")?.value || "",
      unit,
      unitWeightG: isUnitBased(unit) ? numberOrZero(byId("ingredientUnitWeightG")?.value) : 0
    };
  }

  function findTarget(list, values) {
    if (!Array.isArray(list) || !values) return null;
    if (values.id) {
      const byIdMatch = list.find(item => item && item.id === values.id);
      if (byIdMatch) return byIdMatch;
    }
    const wantedName = normalizeName(values.name);
    if (!wantedName) return null;
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const itemName = normalizeName(list[index]?.name || list[index]?.nombre);
      if (itemName === wantedName) return list[index];
    }
    return null;
  }

  function mergeUnitWeight(list, values) {
    if (!values) return list;
    const item = findTarget(list, values);
    if (!item) return list;
    item.unit = normalizeUnit(values.unit || item.unit || "unidades");
    if (isUnitBased(item.unit)) item.unitWeightG = numberOrZero(values.unitWeightG || item.unitWeightG);
    else delete item.unitWeightG;
    return list;
  }

  function patchLocalStorageWrites() {
    if (storagePatched || !global.localStorage) return;
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function patchedSetItem(key, value) {
      if (key === "ingredients" && pendingIngredientUnitWeight) {
        try {
          const parsed = JSON.parse(String(value || "[]"));
          if (Array.isArray(parsed)) value = JSON.stringify(mergeUnitWeight(parsed, pendingIngredientUnitWeight));
        } catch {
          // Keep original value.
        }
      }
      return originalSetItem.call(this, key, value);
    };
    storagePatched = true;
  }

  function persistCurrentUnitWeight() {
    const values = readPendingIngredient();
    pendingIngredientUnitWeight = values;
    try {
      const list = JSON.parse(localStorage.getItem("ingredients") || "[]");
      if (!Array.isArray(list)) return;
      localStorage.setItem("ingredients", JSON.stringify(mergeUnitWeight(list, values)));
    } catch {
      // Ignore invalid local data.
    }
  }

  function fillUnitWeightOnEdit() {
    const editingId = byId("editingIngredientId")?.value || "";
    if (!editingId) return;
    try {
      const list = JSON.parse(localStorage.getItem("ingredients") || "[]");
      const item = Array.isArray(list) ? list.find(entry => entry && entry.id === editingId) : null;
      const unit = byId("ingredientUnit");
      const field = byId("ingredientUnitWeightG");
      if (unit && item) unit.value = normalizeUnit(item.unit || "unidades");
      updateUnitWeightVisibility();
      if (field && item) field.value = item.unitWeightG || "";
    } catch {
      // Ignore invalid local data.
    }
  }

  function install() {
    replaceUnitInputWithSelect();
    ensureUnitWeightField();
    patchLocalStorageWrites();
    updateUnitWeightVisibility();

    const unitField = byId("ingredientUnit");
    if (unitField && unitField.dataset.closedUnitSelector !== "true") {
      unitField.dataset.closedUnitSelector = "true";
      unitField.addEventListener("change", () => {
        unitField.value = normalizeUnit(unitField.value);
        updateUnitWeightVisibility();
      });
    }

    const saveButton = byId("saveIngredientBtn");
    if (saveButton && saveButton.dataset.unitNormalization !== "true") {
      saveButton.dataset.unitNormalization = "true";
      saveButton.addEventListener("click", () => {
        pendingIngredientUnitWeight = readPendingIngredient();
        setTimeout(persistCurrentUnitWeight, 0);
        setTimeout(persistCurrentUnitWeight, 200);
      }, true);
    }

    document.addEventListener("click", event => {
      const button = event.target.closest("button");
      if (!button || !/Editar/.test(button.textContent || "")) return;
      setTimeout(fillUnitWeightOnEdit, 80);
    }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
  document.addEventListener?.("planificador:modules-ready", install);
  setTimeout(install, 500);

  global.UnitNormalization = {
    ALLOWED_UNITS,
    normalizeUnit,
    isUnitBased,
    mergeUnitWeight,
    persistCurrentUnitWeight,
    install
  };
})(typeof window !== "undefined" ? window : globalThis);
