/*
 * UI safety net for PlanificadorComidas.
 * Ensures critical navigation and lifecycle/price fields exist even if older cached HTML is served
 * or an optional module fails to initialize.
 */
(function attachUiSafetyNet(global) {
  "use strict";

  function byId(id) {
    return document.getElementById(id);
  }

  function insertAfter(reference, node) {
    if (!reference || !reference.parentElement || !node) return false;
    reference.parentElement.insertBefore(node, reference.nextSibling);
    return true;
  }

  function ensureCaducidadesTab() {
    if (byId("expiryDashboardLink")) return;
    const tabs = document.querySelector(".tabs");
    if (!tabs) return;
    const link = document.createElement("a");
    link.id = "expiryDashboardLink";
    link.href = "caducidades.html";
    link.className = "tab-btn";
    link.style.textAlign = "center";
    link.style.textDecoration = "none";
    link.textContent = "Caducidades";
    tabs.appendChild(link);
  }

  function ensureIngredientPriceField() {
    if (byId("ingredientApproxPrice")) return;
    const familySelect = byId("ingredientFamilySelect");
    if (!familySelect) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <label for="ingredientApproxPrice">Precio aprox. de referencia</label>
      <input id="ingredientApproxPrice" type="number" min="0" step="0.01" placeholder="Ej. 1.99" />
      <div class="help">Precio aproximado para calcular coste si no hay producto asociado.</div>`;
    insertAfter(familySelect, wrapper);
  }

  function ensureDishPriceField() {
    if (byId("dishApproxPrice")) return;
    const difficulty = byId("dishDifficulty");
    if (!difficulty) return;
    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <label for="dishApproxPrice">Precio aprox. por ración</label>
      <input id="dishApproxPrice" type="number" min="0" step="0.01" placeholder="Ej. 2.50" />`;
    insertAfter(difficulty.closest(".row") || difficulty, wrapper);
  }

  function ensureIngredientLifecycleFields() {
    if (byId("ingredientExpiryDate")) return;
    const productsBox = byId("ingredientProducts")?.closest(".scanner-box") || byId("ingredientApproxPrice") || byId("ingredientFamilySelect");
    if (!productsBox) return;
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
      </div>`;
    insertAfter(productsBox, wrapper);
  }

  function ensureDishLifecycleFields() {
    if (byId("dishPreparedDate") || byId("dishExpiryDate")) return;
    const price = byId("dishApproxPrice") || byId("dishNotes");
    if (!price) return;
    const wrapper = document.createElement("div");
    wrapper.id = "dishLifecycleFields";
    wrapper.innerHTML = `
      <div class="row">
        <div>
          <label for="dishPreparedDate">Fecha de preparación</label>
          <input id="dishPreparedDate" type="date" />
        </div>
        <div>
          <label for="dishExpiryDate">Caducidad / consumir antes de</label>
          <input id="dishExpiryDate" type="date" />
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
    insertAfter(price, wrapper);
  }

  function install() {
    ensureCaducidadesTab();
    ensureIngredientPriceField();
    ensureDishPriceField();
    ensureIngredientLifecycleFields();
    ensureDishLifecycleFields();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
  document.addEventListener?.("planificador:modules-ready", install);
  setTimeout(install, 500);

  global.UiSafetyNet = { install };
})(typeof window !== "undefined" ? window : globalThis);
