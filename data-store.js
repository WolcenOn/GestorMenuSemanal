/*
 * Safe localStorage data store for PlanificadorComidas.
 * Centralizes JSON parsing, validation, migrations and backup/restore helpers.
 */
(function attachPlanificadorDataStore(global) {
  "use strict";

  const STORAGE_KEYS = {
    ingredientFamilies: "ingredientFamilies",
    ingredients: "ingredients",
    dishPacks: "dishPacks",
    dishes: "dishes",
    favoriteIds: "favoriteDishIds",
    familyMembers: "familyMembers",
    mealTypes: "mealTypes",
    weeks: "savedWeeks",
    activeWeekId: "activeWeekId",
    typicalWeekPlan: "typicalWeekPlan",
    remotePacksPath: "remotePacksPath",
    remoteRepoOwner: "remoteRepoOwner",
    remoteRepoName: "remoteRepoName",
    remoteRepoBranch: "remoteRepoBranch"
  };

  const DEFAULT_DATA = {
    app: "gestor-comidas",
    version: 4,
    ingredientFamilies: [],
    ingredients: [],
    dishPacks: [{ id: "pack-general", name: "General" }],
    dishes: [],
    favoriteIds: [],
    familyMembers: [{ id: "member-default", name: "Todos" }],
    mealTypes: [{ id: "meal-lunch", name: "Comida" }, { id: "meal-dinner", name: "Cena" }],
    weeks: [{ id: "week-default", name: "Semana 1", plan: {}, createdAt: "", isTypical: true }],
    activeWeekId: "week-default",
    typicalWeekPlan: null,
    remotePacksPath: "packs/recetas",
    remoteRepoOwner: "",
    remoteRepoName: "",
    remoteRepoBranch: "main"
  };

  const LIMITS = {
    text: 5000,
    name: 160,
    id: 140,
    array: 1000,
    weeks: 250,
    jsonBytes: 1_000_000
  };

  function createId(prefix = "id") {
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function cleanText(value, max = LIMITS.text, fallback = "") {
    return String(value ?? fallback)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
      .trim()
      .slice(0, max);
  }

  function cleanId(value, prefix = "id") {
    return cleanText(value, LIMITS.id) || createId(prefix);
  }

  function numberInRange(value, fallback = 0, min = 0, max = 1_000_000) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, number));
  }

  function cleanDate(value) {
    const text = cleanText(value, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const date = new Date(`${text}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "" : text;
  }

  function asArray(value, max = LIMITS.array) {
    return Array.isArray(value) ? value.slice(0, max) : [];
  }

  function asObject(value, fallback = {}) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : fallback;
  }

  function safeParseJson(text, fallback = null) {
    const raw = String(text ?? "");
    if (!raw.trim()) return fallback;
    if (raw.length > LIMITS.jsonBytes) throw new Error("El JSON supera el tamano maximo permitido.");
    return JSON.parse(raw);
  }

  function readJson(key, fallback) {
    try {
      const raw = global.localStorage?.getItem(key);
      if (!raw) return fallback;
      return safeParseJson(raw, fallback);
    } catch (error) {
      console.warn(`No se pudo leer ${key} desde localStorage`, error);
      return fallback;
    }
  }

  function writeJson(key, value) {
    global.localStorage?.setItem(key, JSON.stringify(value));
  }

  function normalizeStorageType(value, fallback = "pantry") {
    const clean = cleanText(value, 20).toLowerCase();
    return ["pantry", "fridge", "freezer"].includes(clean) ? clean : fallback;
  }

  function normalizeFamily(item = {}) {
    return {
      id: cleanId(item.id, "fam"),
      name: cleanText(item.name || item.nombre || "Familia", LIMITS.name)
    };
  }

  function normalizeProduct(item = {}) {
    return {
      id: cleanText(item.id, LIMITS.id),
      barcode: cleanText(item.barcode || item.code, 80),
      brand: cleanText(item.brand || item.brands, LIMITS.name),
      packageQty: numberInRange(item.packageQty ?? item.qty ?? item.quantity, 0),
      packageUnit: cleanText(item.packageUnit || item.unit || "unidades", 40),
      price: numberInRange(item.price, 0, 0, 100_000),
      source: cleanText(item.source, 80),
      productName: cleanText(item.productName || item.product_name || item.name, LIMITS.name),
      quantityText: cleanText(item.quantityText || item.quantity, 80),
      imageUrl: cleanText(item.imageUrl || item.image_small_url || item.image_url, 500),
      offUrl: cleanText(item.offUrl || item.url, 500),
      nutriscore: cleanText(item.nutriscore || item.nutriscore_grade, 5),
      novaGroup: cleanText(item.novaGroup || item.nova_group, 5),
      categories: cleanText(item.categories, 500)
    };
  }

  function normalizeStockLot(item = {}, ingredient = {}) {
    return {
      id: cleanId(item.id, "lot"),
      ingredientId: cleanText(item.ingredientId || ingredient.id, LIMITS.id),
      qty: numberInRange(item.qty ?? item.quantity, 0),
      unit: cleanText(item.unit || ingredient.unit || "unidades", 40),
      expiryDate: cleanDate(item.expiryDate || item.caducidad || item.fechaCaducidad),
      openedDate: cleanDate(item.openedDate || item.fechaApertura),
      frozenDate: cleanDate(item.frozenDate || item.fechaCongelado),
      storageType: normalizeStorageType(item.storageType || item.conservacion || ingredient.storageType || "pantry"),
      productId: cleanText(item.productId, LIMITS.id),
      unitCost: numberInRange(item.unitCost, 0, 0, 1000),
      note: cleanText(item.note || item.notes || item.nota, 300)
    };
  }

  function normalizeIngredient(item = {}) {
    const ingredient = {
      id: cleanId(item.id, "ing"),
      name: cleanText(item.name || item.nombre || "Ingrediente", LIMITS.name),
      qty: numberInRange(item.qty ?? item.cantidad, 0),
      unit: cleanText(item.unit || item.unidad || "unidades", 40),
      available: item.available !== false && item.disponible !== false,
      familyId: cleanText(item.familyId, LIMITS.id),
      family: cleanText(item.family || item.familia || item.familyName, LIMITS.name),
      approxPrice: numberInRange(item.approxPrice ?? item.priceApprox ?? item.precioAproximado ?? item.price, 0, 0, 100_000),
      expiryDate: cleanDate(item.expiryDate || item.caducidad || item.bestBeforeDate || item.fechaCaducidad),
      openedDate: cleanDate(item.openedDate || item.fechaApertura),
      preparedDate: cleanDate(item.preparedDate || item.fechaPreparacion),
      frozenDate: cleanDate(item.frozenDate || item.fechaCongelado),
      storageType: normalizeStorageType(item.storageType || item.conservacion, item.frozenDate ? "freezer" : "pantry"),
      discardedDate: cleanDate(item.discardedDate || item.fechaDesperdicio),
      discardedQty: numberInRange(item.discardedQty ?? item.cantidadDesperdiciada, 0),
      wasteReason: cleanText(item.wasteReason || item.motivoDesperdicio, 300),
      products: asArray(item.products || item.barcodes, 200).map(normalizeProduct),
      stockLots: []
    };
    ingredient.stockLots = asArray(item.stockLots || item.lotes, 200).map(lot => normalizeStockLot(lot, ingredient));
    return ingredient;
  }

  function normalizeRecipeRow(item = {}) {
    return {
      ingredientId: cleanText(item.ingredientId, LIMITS.id),
      name: cleanText(item.name || item.nombre, LIMITS.name),
      qty: numberInRange(item.qty ?? item.qtyPerServing ?? item.cantidad ?? item.amount, 0),
      unit: cleanText(item.unit || item.unidad, 40),
      family: cleanText(item.family || item.familia, LIMITS.name),
      approxPrice: numberInRange(item.approxPrice ?? item.price, 0, 0, 100_000)
    };
  }

  function normalizeDish(item = {}) {
    return {
      id: cleanId(item.id, "dish"),
      name: cleanText(item.name || item.nombre || "Plato", LIMITS.name),
      qty: numberInRange(item.qty ?? item.racionesPreparadas ?? item.stock, 0),
      unit: cleanText(item.unit || item.unidad || "raciones", 40),
      baseServings: numberInRange(item.baseServings ?? item.racionesBase, 1, 1, 1000),
      notes: cleanText(item.notes || item.notas, LIMITS.text),
      packId: cleanText(item.packId, LIMITS.id),
      pack: cleanText(item.pack || item.packName || item.collection || item.coleccion, LIMITS.name),
      category: cleanText(item.category || item.categoria, LIMITS.name),
      tags: asArray(Array.isArray(item.tags) ? item.tags : String(item.tags || item.etiquetas || "").split(/[,;|]/), 80).map(tag => cleanText(tag, 60)).filter(Boolean),
      prepTime: cleanText(item.prepTime || item.tiempo || item.time, 80),
      difficulty: cleanText(item.difficulty || item.dificultad, 80),
      approxPrice: numberInRange(item.approxPrice ?? item.priceApprox ?? item.precioAproximado ?? item.price, 0, 0, 100_000),
      expiryDate: cleanDate(item.expiryDate || item.caducidad || item.bestBeforeDate || item.fechaCaducidad),
      preparedDate: cleanDate(item.preparedDate || item.fechaPreparacion || item.cookedDate),
      frozenDate: cleanDate(item.frozenDate || item.fechaCongelado),
      storageType: normalizeStorageType(item.storageType || item.conservacion, item.frozenDate ? "freezer" : "fridge"),
      discardedDate: cleanDate(item.discardedDate || item.fechaDesperdicio),
      discardedQty: numberInRange(item.discardedQty ?? item.cantidadDesperdiciada, 0),
      wasteReason: cleanText(item.wasteReason || item.motivoDesperdicio, 300),
      recipe: asArray(item.recipe || item.ingredients || item.ingredientes || item.receta, LIMITS.array).map(normalizeRecipeRow)
    };
  }

  function normalizePack(item = {}) {
    return { id: cleanId(item.id, "pack"), name: cleanText(item.name || item.nombre || "Pack", LIMITS.name) };
  }

  function normalizeMember(item = {}) {
    return { id: cleanId(item.id, "member"), name: cleanText(item.name || item.nombre || "Miembro", LIMITS.name) };
  }

  function normalizeMealType(item = {}) {
    return { id: cleanId(item.id, "meal"), name: cleanText(item.name || item.nombre || "Comida", LIMITS.name) };
  }

  function normalizeWeek(item = {}) {
    return {
      id: cleanId(item.id, "week"),
      name: cleanText(item.name || item.nombre || "Semana", LIMITS.name),
      plan: asObject(item.plan, {}),
      createdAt: cleanText(item.createdAt || new Date().toISOString(), 40),
      isTypical: item.isTypical === true
    };
  }

  function normalizeBackup(data = {}) {
    const raw = asObject(data, {});
    const result = {
      ...DEFAULT_DATA,
      app: cleanText(raw.app || DEFAULT_DATA.app, 80),
      version: Math.max(4, numberInRange(raw.version, 4, 0, 100)),
      ingredientFamilies: asArray(raw.ingredientFamilies).map(normalizeFamily),
      ingredients: asArray(raw.ingredients).map(normalizeIngredient),
      dishPacks: asArray(raw.dishPacks).map(normalizePack),
      dishes: asArray(raw.dishes).map(normalizeDish),
      favoriteIds: asArray(raw.favoriteIds || raw.favoriteDishIds).map(id => cleanText(id, LIMITS.id)).filter(Boolean),
      familyMembers: asArray(raw.familyMembers).map(normalizeMember),
      mealTypes: asArray(raw.mealTypes).map(normalizeMealType),
      weeks: asArray(raw.weeks || raw.savedWeeks, LIMITS.weeks).map(normalizeWeek),
      activeWeekId: cleanText(raw.activeWeekId, LIMITS.id),
      typicalWeekPlan: raw.typicalWeekPlan && typeof raw.typicalWeekPlan === "object" ? raw.typicalWeekPlan : null,
      remotePacksPath: cleanText(raw.remotePacksPath || DEFAULT_DATA.remotePacksPath, 240),
      remoteRepoOwner: cleanText(raw.remoteRepoOwner, 120),
      remoteRepoName: cleanText(raw.remoteRepoName, 120),
      remoteRepoBranch: cleanText(raw.remoteRepoBranch || DEFAULT_DATA.remoteRepoBranch, 120)
    };

    if (!result.dishPacks.length) result.dishPacks = DEFAULT_DATA.dishPacks;
    if (!result.familyMembers.length) result.familyMembers = DEFAULT_DATA.familyMembers;
    if (!result.mealTypes.length) result.mealTypes = DEFAULT_DATA.mealTypes;
    if (!result.weeks.length) result.weeks = [{ ...DEFAULT_DATA.weeks[0], createdAt: new Date().toISOString() }];
    if (!result.activeWeekId || !result.weeks.some(week => week.id === result.activeWeekId)) result.activeWeekId = result.weeks[0].id;
    return result;
  }

  function loadAll(storage = global.localStorage) {
    const data = normalizeBackup({
      ingredientFamilies: readJson(STORAGE_KEYS.ingredientFamilies, []),
      ingredients: readJson(STORAGE_KEYS.ingredients, []),
      dishPacks: readJson(STORAGE_KEYS.dishPacks, DEFAULT_DATA.dishPacks),
      dishes: readJson(STORAGE_KEYS.dishes, []),
      favoriteIds: readJson(STORAGE_KEYS.favoriteIds, []),
      familyMembers: readJson(STORAGE_KEYS.familyMembers, DEFAULT_DATA.familyMembers),
      mealTypes: readJson(STORAGE_KEYS.mealTypes, DEFAULT_DATA.mealTypes),
      weeks: readJson(STORAGE_KEYS.weeks, DEFAULT_DATA.weeks),
      activeWeekId: storage?.getItem(STORAGE_KEYS.activeWeekId) || DEFAULT_DATA.activeWeekId,
      typicalWeekPlan: readJson(STORAGE_KEYS.typicalWeekPlan, null),
      remotePacksPath: storage?.getItem(STORAGE_KEYS.remotePacksPath) || DEFAULT_DATA.remotePacksPath,
      remoteRepoOwner: storage?.getItem(STORAGE_KEYS.remoteRepoOwner) || "",
      remoteRepoName: storage?.getItem(STORAGE_KEYS.remoteRepoName) || "",
      remoteRepoBranch: storage?.getItem(STORAGE_KEYS.remoteRepoBranch) || DEFAULT_DATA.remoteRepoBranch
    });
    return data;
  }

  function saveAll(data, storage = global.localStorage) {
    const clean = normalizeBackup(data);
    storage?.setItem(STORAGE_KEYS.ingredientFamilies, JSON.stringify(clean.ingredientFamilies));
    storage?.setItem(STORAGE_KEYS.ingredients, JSON.stringify(clean.ingredients));
    storage?.setItem(STORAGE_KEYS.dishPacks, JSON.stringify(clean.dishPacks));
    storage?.setItem(STORAGE_KEYS.dishes, JSON.stringify(clean.dishes));
    storage?.setItem(STORAGE_KEYS.favoriteIds, JSON.stringify(clean.favoriteIds));
    storage?.setItem(STORAGE_KEYS.familyMembers, JSON.stringify(clean.familyMembers));
    storage?.setItem(STORAGE_KEYS.mealTypes, JSON.stringify(clean.mealTypes));
    storage?.setItem(STORAGE_KEYS.weeks, JSON.stringify(clean.weeks));
    storage?.setItem(STORAGE_KEYS.activeWeekId, clean.activeWeekId);
    storage?.setItem(STORAGE_KEYS.typicalWeekPlan, JSON.stringify(clean.typicalWeekPlan));
    storage?.setItem(STORAGE_KEYS.remotePacksPath, clean.remotePacksPath);
    storage?.setItem(STORAGE_KEYS.remoteRepoOwner, clean.remoteRepoOwner);
    storage?.setItem(STORAGE_KEYS.remoteRepoName, clean.remoteRepoName);
    storage?.setItem(STORAGE_KEYS.remoteRepoBranch, clean.remoteRepoBranch);
    return clean;
  }

  function buildBackup(data) {
    return {
      ...normalizeBackup(data),
      exportedAt: new Date().toISOString()
    };
  }

  function runSelfTests() {
    const dirty = {
      version: 1,
      ingredients: [{ name: " Tomate ", qty: "500", unit: "g", stockLots: [{ qty: "200", unit: "g", expiryDate: "2026-06-05" }] }],
      dishes: [{ name: "Pasta", baseServings: "4", ingredients: [{ name: "Tomate", qty: "150", unit: "g" }] }],
      weeks: [{ name: "Semana", plan: { a: ["dish-1"] } }]
    };
    const clean = normalizeBackup(dirty);
    const assertions = [
      [clean.version === 4, "backup migrates to version 4"],
      [clean.ingredients[0].qty === 500, "ingredient qty is numeric"],
      [clean.ingredients[0].stockLots[0].expiryDate === "2026-06-05", "stock lot expiry is preserved"],
      [clean.dishes[0].baseServings === 4, "dish base servings are normalized"],
      [clean.dishes[0].recipe[0].qty === 150, "recipe qty is normalized"],
      [Boolean(clean.activeWeekId), "active week is guaranteed"]
    ];
    return assertions.map(([ok, message]) => ({ ok, message }));
  }

  global.PlanificadorDataStore = {
    STORAGE_KEYS,
    DEFAULT_DATA,
    LIMITS,
    cleanText,
    cleanDate,
    safeParseJson,
    readJson,
    writeJson,
    normalizeFamily,
    normalizeProduct,
    normalizeStockLot,
    normalizeIngredient,
    normalizeRecipeRow,
    normalizeDish,
    normalizePack,
    normalizeMember,
    normalizeMealType,
    normalizeWeek,
    normalizeBackup,
    loadAll,
    saveAll,
    buildBackup,
    runSelfTests
  };
})(typeof window !== "undefined" ? window : globalThis);
