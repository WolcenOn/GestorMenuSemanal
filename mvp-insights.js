(function attachMvpInsights(global) {
  "use strict";

  const STORAGE = {
    ingredients: "ingredients",
    dishes: "dishes",
    members: "members",
    mealTypes: "mealTypes",
    weeks: "weeks",
    nutritionProfiles: "nutritionProfiles",
    snapshots: "weeklyHistorySnapshots"
  };

  const MACROS = [
    { key: "carbs", label: "Hidratos", unit: "g" },
    { key: "protein", label: "Proteínas", unit: "g" },
    { key: "fat", label: "Grasas", unit: "g" },
    { key: "fiber", label: "Fibra", unit: "g" }
  ];

  let installed = false;

  function byId(id) { return document.getElementById(id); }

  function parseJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      const value = JSON.parse(raw);
      return value ?? fallback;
    } catch {
      return fallback;
    }
  }

  function saveJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function number(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function formatNumber(value, digits = 1) {
    return number(value).toLocaleString("es-ES", { maximumFractionDigits: digits });
  }

  function formatMoney(value) {
    return number(value).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalizeUnit(unit) {
    const clean = String(unit || "").trim().toLowerCase();
    if (["kg", "kilo", "kilos"].includes(clean)) return "kg";
    if (["g", "gr", "gramo", "gramos"].includes(clean)) return "g";
    if (["l", "litro", "litros"].includes(clean)) return "l";
    if (["ml", "mililitro", "mililitros"].includes(clean)) return "ml";
    if (["ud", "uds", "unidad", "unidades"].includes(clean)) return "unidades";
    return clean || "unidades";
  }

  function toBaseAmount(qty, unit, ingredient) {
    const amount = number(qty);
    const normalized = normalizeUnit(unit);
    if (normalized === "kg") return { amount: amount * 1000, baseUnit: "g" };
    if (normalized === "g") return { amount, baseUnit: "g" };
    if (normalized === "l") return { amount: amount * 1000, baseUnit: "ml" };
    if (normalized === "ml") return { amount, baseUnit: "ml" };
    const grams = number(ingredient && (ingredient.unitWeightG || ingredient.servingWeightG));
    if (grams) return { amount: amount * grams, baseUnit: "g" };
    return { amount, baseUnit: "unidades" };
  }

  function profileForIngredient(ingredient, profiles) {
    if (!ingredient) return null;
    return profiles[ingredient.id] || profiles[ingredient.name] || null;
  }

  function addNutrition(total, profile, amountInfo) {
    if (!profile || !amountInfo.amount) return;
    const factor = amountInfo.baseUnit === "unidades" ? amountInfo.amount : amountInfo.amount / 100;
    total.kcal += number(profile.kcal) * factor;
    MACROS.forEach(macro => { total[macro.key] += number(profile[macro.key]) * factor; });
    total.sugar += number(profile.sugar) * factor;
    total.sodium += number(profile.sodium) * factor;
  }

  function emptyNutrition() {
    return { kcal: 0, carbs: 0, protein: 0, fat: 0, fiber: 0, sugar: 0, sodium: 0 };
  }

  function getIngredientMap() {
    return new Map(asArray(parseJson(STORAGE.ingredients, [])).map(item => [item.id, item]));
  }

  function getProfiles() {
    const raw = parseJson(STORAGE.nutritionProfiles, {});
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  }

  function getCurrentWeek() {
    const weeks = parseJson(STORAGE.weeks, {});
    if (!weeks || typeof weeks !== "object") return null;
    const keys = Object.keys(weeks).sort();
    if (!keys.length) return null;
    return { key: keys[keys.length - 1], data: weeks[keys[keys.length - 1]] };
  }

  function dishesById() {
    return new Map(asArray(parseJson(STORAGE.dishes, [])).map(dish => [dish.id, dish]));
  }

  function collectWeekDishes(memberId) {
    const current = getCurrentWeek();
    if (!current || !current.data) return [];
    const found = [];
    const visit = value => {
      if (!value) return;
      if (Array.isArray(value)) return value.forEach(visit);
      if (typeof value === "object") {
        if (value.dishId && (!memberId || value.memberId === memberId || value.member === memberId)) found.push(value.dishId);
        Object.values(value).forEach(visit);
        return;
      }
      if (typeof value === "string" && value.startsWith("id-")) found.push(value);
    };
    visit(current.data);
    return found;
  }

  function computeNutrition(memberId) {
    const ingredientMap = getIngredientMap();
    const profiles = getProfiles();
    const dishMap = dishesById();
    const total = emptyNutrition();
    collectWeekDishes(memberId).forEach(dishId => {
      const dish = dishMap.get(dishId);
      asArray(dish && dish.ingredients).forEach(line => {
        const ingredient = ingredientMap.get(line.ingredientId) || asArray(parseJson(STORAGE.ingredients, [])).find(item => item.name === line.name);
        const profile = profileForIngredient(ingredient, profiles);
        addNutrition(total, profile, toBaseAmount(line.qty, line.unit, ingredient));
      });
    });
    return total;
  }

  function estimateShoppingCost() {
    const ingredients = asArray(parseJson(STORAGE.ingredients, []));
    return ingredients.reduce((sum, ingredient) => sum + number(ingredient.approxPrice || ingredient.price), 0);
  }

  function countWasteRisk() {
    const today = new Date();
    const limit = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
    return asArray(parseJson(STORAGE.ingredients, [])).filter(item => {
      if (!item.expiryDate) return false;
      const date = new Date(item.expiryDate);
      return Number.isFinite(date.getTime()) && date <= limit;
    }).length;
  }

  function injectStyles() {
    if (byId("mvpInsightsStyles")) return;
    const style = document.createElement("style");
    style.id = "mvpInsightsStyles";
    style.textContent = `
      .mvp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:14px 0}.mvp-kpi{border:1px solid var(--border,#cfe7df);border-radius:16px;padding:14px;background:#fff}.mvp-kpi strong{display:block;font-size:1.45rem}.mvp-bars{display:grid;gap:10px}.mvp-bar-row{display:grid;grid-template-columns:95px 1fr 70px;gap:8px;align-items:center}.mvp-bar-track{height:12px;border-radius:99px;background:#e5eef0;overflow:hidden}.mvp-bar-fill{height:100%;border-radius:99px;background:linear-gradient(135deg,var(--primary,#0f9f77),var(--secondary,#0ea5c6))}.mvp-table{width:100%;border-collapse:collapse;margin-top:10px}.mvp-table th,.mvp-table td{border-bottom:1px solid var(--border,#cfe7df);padding:8px;text-align:left}.mvp-panel-actions{display:flex;gap:8px;flex-wrap:wrap;margin:12px 0}.mvp-warning{border:1px solid #fed7aa;background:#fff7ed;border-radius:14px;padding:10px;margin:10px 0;color:#9a3412}`;
    document.head.appendChild(style);
  }

  function addTab(name, label) {
    const tabs = document.querySelector(".tabs");
    if (!tabs || tabs.querySelector(`[data-tab=\"${name}\"]`)) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "tab-btn";
    button.dataset.tab = name;
    button.textContent = label;
    tabs.appendChild(button);
  }

  function addPanel(id, html) {
    const main = document.querySelector("main");
    if (!main || byId(id)) return;
    const section = document.createElement("section");
    section.id = id;
    section.className = "tab-panel card";
    section.innerHTML = html;
    main.appendChild(section);
  }

  function renderNutrition() {
    const members = asArray(parseJson(STORAGE.members, []));
    const select = byId("mvpNutritionMember");
    if (select && !select.dataset.ready) {
      select.innerHTML = `<option value="">Todos / grupo general</option>${members.map(member => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.name)}</option>`).join("")}`;
      select.dataset.ready = "1";
      select.addEventListener("change", renderNutrition);
    }
    const total = computeNutrition(select && select.value);
    const max = Math.max(1, ...MACROS.map(macro => total[macro.key]));
    const bars = MACROS.map(macro => {
      const value = total[macro.key];
      const width = Math.max(4, Math.round((value / max) * 100));
      return `<div class="mvp-bar-row"><strong>${macro.label}</strong><div class="mvp-bar-track"><div class="mvp-bar-fill" style="width:${width}%"></div></div><span>${formatNumber(value)} ${macro.unit}</span></div>`;
    }).join("");
    const target = byId("mvpNutritionContent");
    if (target) target.innerHTML = `<div class="mvp-grid"><div class="mvp-kpi"><span>Kcal estimadas</span><strong>${formatNumber(total.kcal, 0)}</strong></div><div class="mvp-kpi"><span>Azúcares</span><strong>${formatNumber(total.sugar)} g</strong></div><div class="mvp-kpi"><span>Sodio</span><strong>${formatNumber(total.sodium)} mg</strong></div></div><div class="mvp-bars">${bars}</div><p class="muted">Los cálculos dependen de los perfiles nutricionales guardados por ingrediente y de la planificación semanal actual.</p>`;
  }

  function saveSnapshot() {
    const snapshots = asArray(parseJson(STORAGE.snapshots, []));
    const current = getCurrentWeek();
    snapshots.push({
      schemaVersion: 1,
      id: `snap-${Date.now()}`,
      createdAt: new Date().toISOString(),
      weekKey: current ? current.key : "sin-semana",
      estimatedCost: estimateShoppingCost(),
      wasteRisk: countWasteRisk(),
      nutrition: computeNutrition("")
    });
    saveJson(STORAGE.snapshots, snapshots.slice(-52));
    renderHistory();
  }

  function renderHistory() {
    const snapshots = asArray(parseJson(STORAGE.snapshots, [])).slice(-8).reverse();
    const tbody = snapshots.map(item => `<tr><td>${escapeHtml(new Date(item.createdAt).toLocaleDateString("es-ES"))}</td><td>${escapeHtml(item.weekKey)}</td><td>${formatMoney(item.estimatedCost)}</td><td>${formatNumber(item.wasteRisk,0)}</td><td>${formatNumber(item.nutrition && item.nutrition.kcal,0)}</td></tr>`).join("");
    const target = byId("mvpHistoryContent");
    if (target) target.innerHTML = snapshots.length ? `<table class="mvp-table"><thead><tr><th>Fecha</th><th>Semana</th><th>Gasto ref.</th><th>Riesgo</th><th>Kcal</th></tr></thead><tbody>${tbody}</tbody></table>` : `<div class="empty">Guarda una foto semanal para empezar a comparar gasto, desperdicio y nutrición.</div>`;
  }

  function validateData() {
    const issues = [];
    asArray(parseJson(STORAGE.ingredients, [])).forEach((item, index) => {
      if (!String(item.name || "").trim()) issues.push(`Ingrediente ${index + 1}: falta nombre.`);
      if (!normalizeUnit(item.unit)) issues.push(`Ingrediente ${item.name || index + 1}: unidad no válida.`);
    });
    asArray(parseJson(STORAGE.dishes, [])).forEach((dish, index) => {
      if (!String(dish.name || "").trim()) issues.push(`Plato ${index + 1}: falta nombre.`);
      asArray(dish.ingredients).forEach(line => {
        if (!number(line.qty)) issues.push(`Plato ${dish.name || index + 1}: cantidad de receta inválida.`);
      });
    });
    const target = byId("mvpValidationContent");
    if (target) target.innerHTML = issues.length ? `<div class="mvp-warning"><strong>${issues.length} avisos encontrados</strong><ul>${issues.slice(0, 30).map(issue => `<li>${escapeHtml(issue)}</li>`).join("")}</ul></div>` : `<div class="mvp-kpi"><span>Validación local</span><strong>Sin avisos críticos</strong></div>`;
  }

  function install() {
    if (installed) return;
    installed = true;
    injectStyles();
    addTab("nutrition", "Nutrición");
    addTab("history", "Histórico");
    addTab("quality", "Calidad datos");
    addPanel("panel-nutrition", `<h2>Balance nutricional</h2><p class="muted">Macronutrientes estimados por semana y por miembro o grupo.</p><label for="mvpNutritionMember">Miembro o grupo</label><select id="mvpNutritionMember"></select><div id="mvpNutritionContent"></div>`);
    addPanel("panel-history", `<h2>Histórico comparativo</h2><p class="muted">Guarda snapshots semanales para comparar gasto, desperdicio y nutrición antes de migrar a nube.</p><div class="mvp-panel-actions"><button id="mvpSaveSnapshotBtn" type="button">Guardar foto semanal</button></div><div id="mvpHistoryContent"></div>`);
    addPanel("panel-quality", `<h2>Calidad y validación de datos</h2><p class="muted">Revisión local de campos esenciales antes de importar, exportar o sincronizar datos.</p><div class="mvp-panel-actions"><button id="mvpValidateDataBtn" type="button">Validar datos locales</button></div><div id="mvpValidationContent"></div>`);
    byId("mvpSaveSnapshotBtn")?.addEventListener("click", saveSnapshot);
    byId("mvpValidateDataBtn")?.addEventListener("click", validateData);
    document.addEventListener("click", event => {
      const tab = event.target && event.target.closest && event.target.closest(".tab-btn[data-tab]");
      if (!tab) return;
      const name = tab.dataset.tab;
      if (name === "nutrition") setTimeout(renderNutrition, 0);
      if (name === "history") setTimeout(renderHistory, 0);
      if (name === "quality") setTimeout(validateData, 0);
    });
    renderNutrition();
    renderHistory();
  }

  global.MvpInsights = { install, computeNutrition, validateData, saveSnapshot };
})(window);
