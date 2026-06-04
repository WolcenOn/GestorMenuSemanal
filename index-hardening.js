/*
 * Progressive hardening for index.html.
 * Load after the main index script and after stock-lifecycle.js when available.
 * It adds an expiry date field to the ingredient form and sanitizes imported JSON
 * before the existing import handlers process it.
 */
(function attachIndexHardening(global) {
  "use strict";

  const MAX_TEXT = 5000;
  const MAX_NAME = 160;
  const MAX_ARRAY = 500;
  const MAX_JSON_BYTES = 750000;

  function byId(id) {
    return document.getElementById(id);
  }

  function clampText(value, max = MAX_TEXT) {
    return String(value ?? "")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .trim()
      .slice(0, max);
  }

  function numberInRange(value, fallback = 0, min = 0, max = 1000000) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function isDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
  }

  function cleanDate(value) {
    const text = clampText(value, 10);
    if (!isDate(text)) return "";
    const date = new Date(`${text}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "" : text;
  }

  function limitArray(value, max = MAX_ARRAY) {
    return Array.isArray(value) ? value.slice(0, max) : [];
  }

  function cleanStorageType(value, fallback = "pantry") {
    const text = clampText(value, 20).toLowerCase();
    return ["pantry", "fridge", "freezer"].includes(text) ? text : fallback;
  }

  function cleanProduct(product) {
    if (!product || typeof product !== "object") return null;
    return {
      barcode: clampText(product.barcode || product.code, 80),
      brand: clampText(product.brand || product.brands, MAX_NAME),
      packageQty: numberInRange(product.packageQty, 0),
      packageUnit: clampText(product.packageUnit || product.unit || "unidades", 40),
      price: numberInRange(product.price, 0, 0, 100000),
      source: clampText(product.source, 80),
      productName: clampText(product.productName || product.product_name, MAX_NAME),
      quantityText: clampText(product.quantityText || product.quantity, 80),
      imageUrl: clampText(product.imageUrl || product.image_small_url || product.image_url, 500),
      offUrl: clampText(product.offUrl || product.url, 500),
      nutriscore: clampText(product.nutriscore || product.nutriscore_grade, 5),
      novaGroup: clampText(product.novaGroup || product.nova_group, 5),
      categories: clampText(product.categories, 500)
    };
  }

  function cleanIngredient(item) {
    if (!item || typeof item !== "object") return null;
    const raw = {
      ...item,
      id: clampText(item.id, 120),
      name: clampText(item.name || item.nombre || "Ingrediente", MAX_NAME),
      qty: numberInRange(item.qty ?? item.cantidad, 0),
      unit: clampText(item.unit || item.unidad || "unidades", 40),
      family: clampText(item.family || item.familia || item.familyName, MAX_NAME),
      familyId: clampText(item.familyId, 120),
      available: item.available !== false && item.disponible !== false,
      approxPrice: numberInRange(item.approxPrice ?? item.priceApprox ?? item.precioAproximado ?? item.price, 0, 0, 100000),
      expiryDate: cleanDate(item.expiryDate || item.caducidad || item.bestBeforeDate || item.fechaCaducidad),
      openedDate: cleanDate(item.openedDate || item.fechaApertura),
      preparedDate: cleanDate(item.preparedDate || item.fechaPreparacion),
      frozenDate: cleanDate(item.frozenDate || item.fechaCongelado),
      storageType: cleanStorageType(item.storageType || item.conservacion, item.frozenDate ? "freezer" : "pantry"),
      discardedDate: cleanDate(item.discardedDate || item.fechaDesperdicio),
      discardedQty: numberInRange(item.discardedQty ?? item.cantidadDesperdiciada, 0),
      wasteReason: clampText(item.wasteReason || item.motivoDesperdicio, 300),
      products: limitArray(item.products || item.barcodes).map(cleanProduct).filter(Boolean)
    };

    return global.StockLifecycle ? global.StockLifecycle.normalizeIngredientStock(raw) : raw;
  }

  function cleanRecipeRow(row) {
    if (!row || typeof row !== "object") return null;
    return {
      ingredientId: clampText(row.ingredientId, 120),
      name: clampText(row.name || row.nombre, MAX_NAME),
      qty: numberInRange(row.qty ?? row.cantidad ?? row.amount, 1, 0, 100000),
      unit: clampText(row.unit || row.unidad, 40),
      family: clampText(row.family || row.familia, MAX_NAME),
      approxPrice: numberInRange(row.approxPrice ?? row.price, 0, 0, 100000)
    };
  }

  function cleanDish(item) {
    if (!item || typeof item !== "object") return null;
    const raw = {
      ...item,
      id: clampText(item.id, 120),
      name: clampText(item.name || item.nombre || "Plato", MAX_NAME),
      qty: numberInRange(item.qty ?? item.racionesPreparadas ?? item.stock, 0),
      unit: clampText(item.unit || item.unidad || "raciones", 40),
      pack: clampText(item.pack || item.packName || item.collection || item.coleccion, MAX_NAME),
      packId: clampText(item.packId, 120),
      category: clampText(item.category || item.categoria, MAX_NAME),
      tags: limitArray(item.tags || item.etiquetas || item.dietTags || item.dietaryTags, 40).map(tag => clampText(tag, 60)).filter(Boolean),
      prepTime: clampText(item.prepTime || item.tiempo || item.time, 80),
      difficulty: clampText(item.difficulty || item.dificultad, 80),
      approxPrice: numberInRange(item.approxPrice ?? item.priceApprox ?? item.precioAproximado ?? item.price, 0, 0, 100000),
      notes: clampText(item.notes || item.notas, MAX_TEXT),
      expiryDate: cleanDate(item.expiryDate || item.caducidad || item.bestBeforeDate || item.fechaCaducidad),
      preparedDate: cleanDate(item.preparedDate || item.fechaPreparacion || item.cookedDate),
      frozenDate: cleanDate(item.frozenDate || item.fechaCongelado),
      storageType: cleanStorageType(item.storageType || item.conservacion, item.frozenDate ? "freezer" : "fridge"),
      discardedDate: cleanDate(item.discardedDate || item.fechaDesperdicio),
      discardedQty: numberInRange(item.discardedQty ?? item.cantidadDesperdiciada, 0),
      wasteReason: clampText(item.wasteReason || item.motivoDesperdicio, 300),
      recipe: limitArray(item.recipe || item.ingredients || item.ingredientes || item.receta, MAX_ARRAY).map(cleanRecipeRow).filter(Boolean),
      ingredients: limitArray(item.ingredients || item.ingredientes, MAX_ARRAY).map(cleanRecipeRow).filter(Boolean)
    };

    return global.StockLifecycle ? global.StockLifecycle.normalizeDishStock(raw) : raw;
  }

  function extractIngredients(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.ingredients)) return data.ingredients;
    if (data && Array.isArray(data.ingredientes)) return data.ingredientes;
    return [];
  }

  function extractDishes(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.dishes)) return data.dishes;
    if (data && Array.isArray(data.platos)) return data.platos;
    if (data && Array.isArray(data.recipes)) return data.recipes;
    if (data && Array.isArray(data.recetas)) return data.recetas;
    return [];
  }

  function cleanBackup(data) {
    const output = data && typeof data === "object" && !Array.isArray(data) ? { ...data } : {};
    output.app = clampText(output.app || "gestor-comidas", 80);
    output.version = Math.max(3, numberInRange(output.version, 3, 0, 100));
    output.ingredientFamilies = limitArray(output.ingredientFamilies).map(family => ({
      id: clampText(family && family.id, 120),
      name: clampText(family && (family.name || family.nombre || "Familia"), MAX_NAME)
    }));
    output.ingredients = extractIngredients(output).map(cleanIngredient).filter(Boolean);
    output.dishPacks = limitArray(output.dishPacks).map(pack => ({
      id: clampText(pack && pack.id, 120),
      name: clampText(pack && (pack.name || pack.nombre || "Pack"), MAX_NAME)
    }));
    output.dishes = extractDishes(output).map(cleanDish).filter(Boolean);
    output.favoriteIds = limitArray(output.favoriteIds).map(id => clampText(id, 120)).filter(Boolean);
    output.familyMembers = limitArray(output.familyMembers).map(member => ({
      id: clampText(member && member.id, 120),
      name: clampText(member && (member.name || member.nombre || "Miembro"), MAX_NAME)
    }));
    output.mealTypes = limitArray(output.mealTypes).map(meal => ({
      id: clampText(meal && meal.id, 120),
      name: clampText(meal && (meal.name || meal.nombre || "Comida"), MAX_NAME)
    }));
    output.weeks = limitArray(output.weeks, 200).map(week => ({
      id: clampText(week && week.id, 120),
      name: clampText(week && (week.name || week.nombre || "Semana"), MAX_NAME),
      plan: week && week.plan && typeof week.plan === "object" && !Array.isArray(week.plan) ? week.plan : {},
      createdAt: clampText(week && week.createdAt, 40),
      isTypical: week && week.isTypical === true
    }));
    output.activeWeekId = clampText(output.activeWeekId, 120);
    output.typicalWeekPlan = output.typicalWeekPlan && typeof output.typicalWeekPlan === "object" ? output.typicalWeekPlan : null;
    return output;
  }

  function cleanImportPayload(data, mode) {
    if (mode === "ingredients") return extractIngredients(data).map(cleanIngredient).filter(Boolean);
    if (mode === "dishes") return extractDishes(data).map(cleanDish).filter(Boolean);
    return cleanBackup(data);
  }

  function hardenTextarea(textareaId, mode) {
    const textarea = byId(textareaId);
    if (!textarea) return true;
    const raw = textarea.value.trim();
    if (!raw) return true;
    if (raw.length > MAX_JSON_BYTES) {
      alert("El JSON es demasiado grande para importarlo de forma segura.");
      return false;
    }
    try {
      const parsed = JSON.parse(raw);
      textarea.value = JSON.stringify(cleanImportPayload(parsed, mode), null, 2);
      return true;
    } catch {
      alert("El JSON no es valido.");
      return false;
    }
  }

  function installImportHardening() {
    const bindings = [
      ["importJsonBtn", "importJsonText", "backup"],
      ["importIngredientsBtn", "importIngredientsText", "ingredients"],
      ["importDishesBtn", "importDishesText", "dishes"]
    ];

    bindings.forEach(([buttonId, textareaId, mode]) => {
      const button = byId(buttonId);
      if (!button || button.dataset.hardened === "true") return;
      button.dataset.hardened = "true";
      button.addEventListener("click", event => {
        const ok = hardenTextarea(textareaId, mode);
        if (!ok) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
    });
  }

  function installIngredientExpiryField() {
    const available = byId("ingredientAvailable");
    if (!available || byId("ingredientExpiryDate")) return;

    const wrapper = document.createElement("div");
    wrapper.className = "row";
    wrapper.innerHTML = `
      <div>
        <label for="ingredientExpiryDate">Caducidad / consumo preferente</label>
        <input id="ingredientExpiryDate" type="date" />
        <div class="help">Opcional. Se guarda junto al ingrediente del stock.</div>
      </div>
      <div>
        <label for="ingredientStorageType">Conservacion</label>
        <select id="ingredientStorageType">
          <option value="pantry">Despensa</option>
          <option value="fridge">Nevera</option>
          <option value="freezer">Congelador</option>
        </select>
        <div class="help">Ayuda a calcular avisos de consumo.</div>
      </div>`;

    const row = available.closest("label") || available.parentElement;
    if (row && row.parentElement) row.parentElement.insertBefore(wrapper, row.nextSibling);

    const saveButton = byId("saveIngredientBtn");
    if (saveButton && saveButton.dataset.expiryPatched !== "true") {
      saveButton.dataset.expiryPatched = "true";
      saveButton.addEventListener("click", () => {
        const editingId = byId("editingIngredientId")?.value || "";
        const name = byId("ingredientName")?.value.trim() || "";
        const expiryDate = cleanDate(byId("ingredientExpiryDate")?.value || "");
        const storageType = cleanStorageType(byId("ingredientStorageType")?.value || "pantry");
        if (!expiryDate && !storageType) return;

        setTimeout(() => {
          try {
            const list = JSON.parse(localStorage.getItem("ingredients") || "[]");
            if (!Array.isArray(list)) return;
            const target = editingId
              ? list.find(item => item && item.id === editingId)
              : [...list].reverse().find(item => item && clampText(item.name || item.nombre, MAX_NAME) === name);
            if (!target) return;
            target.expiryDate = expiryDate;
            target.storageType = storageType;
            localStorage.setItem("ingredients", JSON.stringify(list.map(cleanIngredient).filter(Boolean)));
          } catch (error) {
            console.warn("No se pudo guardar la caducidad del ingrediente", error);
          }
        }, 0);
      });
    }

    const cancelButton = byId("cancelIngredientEditBtn");
    if (cancelButton && cancelButton.dataset.expiryPatched !== "true") {
      cancelButton.dataset.expiryPatched = "true";
      cancelButton.addEventListener("click", () => {
        const expiry = byId("ingredientExpiryDate");
        if (expiry) expiry.value = "";
        const storage = byId("ingredientStorageType");
        if (storage) storage.value = "pantry";
      });
    }
  }

  function installDashboardLink() {
    if (byId("expiryDashboardLink")) return;
    const tabs = document.querySelector(".tabs");
    if (!tabs) return;
    const link = document.createElement("a");
    link.id = "expiryDashboardLink";
    link.href = "caducidades.html";
    link.className = "tab-btn";
    link.textContent = "Caducidades";
    link.style.textAlign = "center";
    link.style.textDecoration = "none";
    tabs.appendChild(link);
  }

  function install() {
    installImportHardening();
    installIngredientExpiryField();
    installDashboardLink();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }

  global.PlanificadorHardening = {
    cleanIngredient,
    cleanDish,
    cleanBackup,
    cleanImportPayload,
    install
  };
})(typeof window !== "undefined" ? window : globalThis);
