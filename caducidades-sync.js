/*
 * Caducidades sync diagnostics and localStorage reconciliation.
 * Ensures the expiry dashboard reads the same localStorage state as index.html
 * and makes the distinction between recipe ingredients and stock ingredients visible.
 */
(function attachCaducidadesSync(global) {
  "use strict";

  function parseArray(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function numberOrZero(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function hasStock(item) {
    return item.available === true || numberOrZero(item.qty ?? item.cantidad ?? item.stock ?? item.racionesPreparadas) > 0;
  }

  function hasLifecycleDate(item) {
    return Boolean(item.expiryDate || item.openedDate || item.preparedDate || item.frozenDate || item.caducidad || item.fechaCaducidad || item.fechaApertura || item.fechaPreparacion || item.fechaCongelado);
  }

  function getState() {
    if (global.LifecyclePersistence?.reconcileLocalStorage) global.LifecyclePersistence.reconcileLocalStorage();
    const rawIngredients = parseArray("ingredients");
    const rawDishes = parseArray("dishes");
    const normalizedIngredients = global.StockLifecycle?.normalizeIngredientStock
      ? rawIngredients.map(global.StockLifecycle.normalizeIngredientStock)
      : rawIngredients;
    const normalizedDishes = global.StockLifecycle?.normalizeDishStock
      ? rawDishes.map(global.StockLifecycle.normalizeDishStock)
      : rawDishes;
    return { rawIngredients, rawDishes, ingredients: normalizedIngredients, dishes: normalizedDishes };
  }

  function counts() {
    const state = getState();
    return {
      ingredientsTotal: state.ingredients.length,
      ingredientsWithStock: state.ingredients.filter(hasStock).length,
      ingredientsWithDate: state.ingredients.filter(hasLifecycleDate).length,
      ingredientsRecipeOnly: state.ingredients.filter(item => !hasStock(item)).length,
      dishesTotal: state.dishes.length,
      dishesWithStock: state.dishes.filter(hasStock).length,
      dishesWithDate: state.dishes.filter(hasLifecycleDate).length,
      localStorageBytes: JSON.stringify({ ingredients: state.rawIngredients, dishes: state.rawDishes }).length
    };
  }

  function ensurePanel() {
    if (document.getElementById("syncDiagnostics")) return;
    const main = document.querySelector("main");
    if (!main) return;
    const section = document.createElement("section");
    section.className = "card";
    section.id = "syncDiagnostics";
    section.innerHTML = `
      <h2>Sincronización de datos</h2>
      <div id="syncDiagnosticsGrid" class="grid"></div>
      <p class="muted">Los packs pueden añadir ingredientes de receta con cantidad 0. Esos ingredientes existen en la base de datos, pero no cuentan como stock hasta que les indiques cantidad o marques que los tienes en casa.</p>
      <div class="actions">
        <button type="button" id="forceSyncBtn" class="ghost">Forzar lectura de localStorage</button>
      </div>`;
    const firstCard = main.querySelector(".card:nth-of-type(2)");
    main.insertBefore(section, firstCard || main.firstChild);
    document.getElementById("forceSyncBtn")?.addEventListener("click", () => {
      if (global.LifecyclePersistence?.reconcileLocalStorage) global.LifecyclePersistence.reconcileLocalStorage();
      if (typeof global.loadData === "function") global.loadData();
      if (typeof global.renderAll === "function") global.renderAll();
      renderDiagnostics();
    });
  }

  function metric(label, value) {
    return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
  }

  function renderDiagnostics() {
    ensurePanel();
    const grid = document.getElementById("syncDiagnosticsGrid");
    if (!grid) return;
    const data = counts();
    grid.innerHTML = [
      metric("Ingredientes leídos", data.ingredientsTotal),
      metric("Ingredientes con stock", data.ingredientsWithStock),
      metric("Ingredientes con fecha", data.ingredientsWithDate),
      metric("Ingredientes solo receta", data.ingredientsRecipeOnly),
      metric("Platos leídos", data.dishesTotal),
      metric("Platos con fecha", data.dishesWithDate)
    ].join("");
  }

  function patchRender() {
    const originalRenderAll = global.renderAll;
    if (typeof originalRenderAll === "function" && !originalRenderAll.__caducidadesSyncPatched) {
      const patched = function patchedRenderAll() {
        const result = originalRenderAll.apply(this, arguments);
        renderDiagnostics();
        return result;
      };
      patched.__caducidadesSyncPatched = true;
      global.renderAll = patched;
    }
  }

  function install() {
    ensurePanel();
    patchRender();
    renderDiagnostics();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
  setTimeout(install, 500);

  global.CaducidadesSync = { getState, counts, renderDiagnostics, install };
})(typeof window !== "undefined" ? window : globalThis);
