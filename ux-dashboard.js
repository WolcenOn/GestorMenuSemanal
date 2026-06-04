/*
 * UX dashboard and grouped navigation for PlanificadorComidas.
 * Progressive enhancement: keeps the monolithic index panels intact while making the entry point clearer.
 */
(function attachUxDashboard(global) {
  "use strict";

  const GROUPS = [
    {
      id: "dashboard",
      label: "Dashboard",
      tabs: ["dashboard"],
      description: "Resumen y accesos rápidos"
    },
    {
      id: "library",
      label: "Biblioteca",
      tabs: ["ingredients", "dishes", "packs", "favorites"],
      description: "Ingredientes, platos, packs y favoritos"
    },
    {
      id: "planning",
      label: "Planificación",
      tabs: ["calendar", "shopping"],
      description: "Calendario y compra"
    },
    {
      id: "settings",
      label: "Configuración",
      tabs: ["config", "weeks", "families", "scanner", "backup"],
      description: "Familia, tipos de comida, semanas, familias, escáner e importación"
    }
  ];

  const TAB_LABELS = {
    dashboard: "Dashboard",
    ingredients: "Ingredientes",
    dishes: "Platos",
    packs: "Packs",
    favorites: "Favoritos",
    calendar: "Calendario",
    shopping: "Compra",
    config: "Familia y comidas",
    weeks: "Semanas",
    families: "Tipos de alimentos",
    scanner: "Escáner/Stock",
    backup: "Importar/Exportar"
  };

  function byId(id) { return document.getElementById(id); }

  function parseArray(key) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }

  function getState() {
    const ingredients = parseArray("ingredients");
    const dishes = parseArray("dishes");
    const packs = parseArray("dishPacks");
    const weeks = parseArray("savedWeeks");
    const members = parseArray("familyMembers");
    const mealTypes = parseArray("mealTypes");
    const families = parseArray("ingredientFamilies");
    const favorites = parseArray("favoriteDishIds");
    const activeWeekId = localStorage.getItem("activeWeekId") || weeks[0]?.id || "";
    const activeWeek = weeks.find(week => week.id === activeWeekId) || weeks[0] || null;
    return { ingredients, dishes, packs, weeks, members, mealTypes, families, favorites, activeWeek };
  }

  function cleanDate(value) {
    const text = String(value || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
    const date = new Date(`${text}T00:00:00`);
    return Number.isNaN(date.getTime()) ? "" : text;
  }

  function daysUntil(dateText) {
    const clean = cleanDate(dateText);
    if (!clean) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(`${clean}T00:00:00`);
    target.setHours(0, 0, 0, 0);
    return Math.round((target.getTime() - today.getTime()) / 86400000);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function getExpiryStats(state) {
    const items = [
      ...state.ingredients.map(item => ({ ...item, itemType: "Ingrediente", qty: Number(item.qty ?? item.cantidad ?? 0) || 0, available: item.available !== false })),
      ...state.dishes.map(item => ({ ...item, itemType: "Plato", qty: Number(item.qty ?? item.racionesPreparadas ?? item.stock ?? 0) || 0, available: true }))
    ];
    const active = items.filter(item => (item.itemType === "Ingrediente" ? item.available !== false : true) && item.qty > 0);
    const stats = { expired: 0, today: 0, soon: 0, missing: 0, alerts: [] };
    active.forEach(item => {
      const days = daysUntil(item.expiryDate || item.caducidad || item.fechaCaducidad || item.preparedDate);
      if (days === null) { stats.missing += 1; return; }
      if (days < 0) { stats.expired += 1; stats.alerts.push({ ...item, severity: "Caducado", days }); }
      else if (days === 0) { stats.today += 1; stats.alerts.push({ ...item, severity: "Hoy", days }); }
      else if (days <= 7) { stats.soon += 1; stats.alerts.push({ ...item, severity: `${days} día/s`, days }); }
    });
    stats.alerts.sort((a, b) => a.days - b.days || String(a.name || "").localeCompare(String(b.name || ""), "es"));
    return stats;
  }

  function addStyles() {
    if (byId("uxDashboardStyles")) return;
    const style = document.createElement("style");
    style.id = "uxDashboardStyles";
    style.textContent = `
      .ux-shell { display: grid; gap: 12px; }
      .ux-main-nav { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; padding: 10px; border: 1px solid var(--border); border-radius: 22px; background: rgba(255,255,255,.82); box-shadow: var(--shadow); }
      .ux-group-card { border: 1px solid var(--border); border-radius: 18px; background: #fff; padding: 12px; cursor: pointer; text-align: left; color: var(--text); }
      .ux-group-card strong { display: block; font-size: 1.05rem; }
      .ux-group-card span { display: block; color: var(--muted); font-size: .86rem; margin-top: 3px; }
      .ux-group-card.active { color: #fff; background: linear-gradient(135deg, var(--primary), var(--blue)); }
      .ux-group-card.active span { color: rgba(255,255,255,.88); }
      .ux-subnav { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px; border: 1px solid var(--border); border-radius: 18px; background: rgba(255,255,255,.72); }
      .ux-subnav .tab-btn { padding: 9px 12px; }
      .ux-dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 12px; }
      .ux-metric { border: 1px solid var(--border); border-radius: 18px; background: linear-gradient(135deg,#fff,#f3fffb); padding: 14px; }
      .ux-metric span { display: block; color: var(--muted); font-size: .88rem; }
      .ux-metric strong { display: block; font-size: 2rem; margin-top: 4px; }
      .ux-quick-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 10px; margin-top: 12px; }
      .ux-quick-card { border: 1px solid var(--border); border-radius: 16px; padding: 12px; background: #fff; display: grid; gap: 8px; }
      .ux-alert-list { display: grid; gap: 8px; margin-top: 12px; }
      .ux-alert-item { border: 1px solid var(--border); border-radius: 14px; padding: 10px; background: #fff; display: flex; justify-content: space-between; gap: 10px; }
      .ux-settings-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; margin-bottom: 14px; }
      .ux-settings-card { border: 1px solid var(--border); border-radius: 16px; padding: 12px; background: #f8fffd; }
      .tabs.ux-hidden-tabs { display: none; }
    `;
    document.head.appendChild(style);
  }

  function activateTab(tab) {
    document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach(button => button.classList.remove("active"));
    byId(`panel-${tab}`)?.classList.add("active");
    document.querySelector(`.tab-btn[data-tab="${CSS.escape(tab)}"]`)?.classList.add("active");
    document.querySelectorAll(".ux-group-card").forEach(card => card.classList.toggle("active", card.dataset.group === groupForTab(tab)));
    renderSubnav(groupForTab(tab));
    if (tab === "dashboard") renderDashboard();
  }

  function groupForTab(tab) {
    return GROUPS.find(group => group.tabs.includes(tab))?.id || "dashboard";
  }

  function renderSubnav(groupId = "dashboard") {
    const subnav = byId("uxSubnav");
    if (!subnav) return;
    const group = GROUPS.find(item => item.id === groupId) || GROUPS[0];
    subnav.innerHTML = group.tabs.map(tab => {
      if (tab === "dashboard") return `<button type="button" class="tab-btn ${byId("panel-dashboard")?.classList.contains("active") ? "active" : ""}" data-tab="dashboard">Dashboard</button>`;
      return `<button type="button" class="tab-btn ${byId(`panel-${tab}`)?.classList.contains("active") ? "active" : ""}" data-tab="${tab}">${TAB_LABELS[tab] || tab}</button>`;
    }).join("");
  }

  function createShell() {
    const oldTabs = document.querySelector("nav.tabs");
    const main = document.querySelector("main");
    if (!oldTabs || !main || byId("uxShell")) return;

    oldTabs.classList.add("ux-hidden-tabs");

    const shell = document.createElement("section");
    shell.id = "uxShell";
    shell.className = "ux-shell no-print";
    shell.innerHTML = `
      <nav class="ux-main-nav" aria-label="Navegación agrupada">
        ${GROUPS.map(group => `<button type="button" class="ux-group-card ${group.id === "dashboard" ? "active" : ""}" data-group="${group.id}"><strong>${group.label}</strong><span>${group.description}</span></button>`).join("")}
      </nav>
      <nav id="uxSubnav" class="ux-subnav" aria-label="Subsecciones"></nav>`;
    oldTabs.after(shell);

    shell.addEventListener("click", event => {
      const groupButton = event.target.closest(".ux-group-card");
      if (groupButton) {
        const group = GROUPS.find(item => item.id === groupButton.dataset.group) || GROUPS[0];
        activateTab(group.tabs[0]);
        return;
      }
      const tabButton = event.target.closest(".tab-btn[data-tab]");
      if (tabButton) activateTab(tabButton.dataset.tab);
    });
  }

  function createDashboardPanel() {
    if (byId("panel-dashboard")) return;
    const firstPanel = document.querySelector(".tab-panel");
    if (!firstPanel) return;
    const panel = document.createElement("section");
    panel.id = "panel-dashboard";
    panel.className = "tab-panel active card";
    panel.innerHTML = `
      <h2>Dashboard</h2>
      <p class="muted">Resumen rápido del planificador y accesos a las acciones principales.</p>
      <div id="uxDashboardMetrics" class="ux-dashboard-grid"></div>
      <h3 style="margin-top:16px">Accesos rápidos</h3>
      <div id="uxQuickActions" class="ux-quick-grid"></div>
      <h3 style="margin-top:16px">Alarmas</h3>
      <div id="uxDashboardAlerts" class="ux-alert-list"></div>`;
    firstPanel.before(panel);
    firstPanel.classList.remove("active");
  }

  function renderDashboard() {
    const state = getState();
    const stats = getExpiryStats(state);
    const activeWeekName = state.activeWeek?.name || "Sin semana activa";
    const plannedSlots = state.activeWeek?.plan ? Object.keys(state.activeWeek.plan).length : 0;

    const metrics = byId("uxDashboardMetrics");
    if (metrics) {
      metrics.innerHTML = `
        <div class="ux-metric"><span>Ingredientes</span><strong>${state.ingredients.length}</strong></div>
        <div class="ux-metric"><span>Platos</span><strong>${state.dishes.length}</strong></div>
        <div class="ux-metric"><span>Packs</span><strong>${state.packs.length}</strong></div>
        <div class="ux-metric"><span>Semana activa</span><strong style="font-size:1.15rem">${escapeHtml(activeWeekName)}</strong><span>${plannedSlots} huecos planificados</span></div>
        <div class="ux-metric"><span>Alarmas</span><strong>${stats.expired + stats.today + stats.soon}</strong><span>${stats.missing} sin fecha</span></div>
        <div class="ux-metric"><span>Configuración</span><strong>${state.members.length}/${state.mealTypes.length}</strong><span>miembros / tipos comida</span></div>`;
    }

    const quick = byId("uxQuickActions");
    if (quick) {
      quick.innerHTML = `
        ${quickCard("Añadir ingrediente", "Registrar stock, precio, unidad y caducidad.", "ingredients")}
        ${quickCard("Crear plato", "Guardar receta, raciones y procedimiento.", "dishes")}
        ${quickCard("Cargar packs", "Importar packs de recetas desde GitHub o JSON.", "packs")}
        ${quickCard("Planificar semana", "Asignar platos por día, miembro y comida.", "calendar")}
        ${quickCard("Ver compra", "Revisar faltantes, coste y sobrantes.", "shopping")}
        <div class="ux-quick-card"><strong>Caducidades</strong><span class="muted">Revisar alarmas, tirado/utilizado e histórico.</span><a href="caducidades.html"><button type="button">Abrir caducidades</button></a></div>`;
    }

    const alerts = byId("uxDashboardAlerts");
    if (alerts) {
      if (!stats.alerts.length) {
        alerts.innerHTML = '<div class="empty">No hay alarmas urgentes de caducidad.</div>';
      } else {
        alerts.innerHTML = stats.alerts.slice(0, 6).map(item => `<div class="ux-alert-item"><div><strong>${escapeHtml(item.name || item.nombre || "Sin nombre")}</strong><div class="muted">${escapeHtml(item.itemType)} · ${escapeHtml(item.severity)}</div></div><a href="caducidades.html"><button type="button" class="ghost">Ver</button></a></div>`).join("");
      }
    }
  }

  function quickCard(title, text, tab) {
    return `<div class="ux-quick-card"><strong>${escapeHtml(title)}</strong><span class="muted">${escapeHtml(text)}</span><button type="button" data-tab="${escapeHtml(tab)}">Abrir</button></div>`;
  }

  function enhanceSettingsPanel() {
    const panel = byId("panel-config");
    if (!panel || byId("uxSettingsIntro")) return;
    const intro = document.createElement("div");
    intro.id = "uxSettingsIntro";
    intro.className = "ux-settings-grid";
    intro.innerHTML = `
      <div class="ux-settings-card"><strong>Miembros</strong><div class="muted">Quién come en casa y para quién se planifica.</div></div>
      <div class="ux-settings-card"><strong>Tipos de comida</strong><div class="muted">Desayuno, comida, cena, merienda u otros momentos.</div></div>
      <div class="ux-settings-card"><strong>Semanas</strong><div class="muted">Crear, duplicar y marcar semanas tipo.</div><button type="button" data-tab="weeks" style="margin-top:8px">Gestionar semanas</button></div>
      <div class="ux-settings-card"><strong>Tipos de alimentos</strong><div class="muted">Familias como fruta, verdura, lácteos o despensa.</div><button type="button" data-tab="families" style="margin-top:8px">Gestionar tipos</button></div>
      <div class="ux-settings-card"><strong>Datos</strong><div class="muted">Copias, importación y exportación.</div><button type="button" data-tab="backup" style="margin-top:8px">Importar/Exportar</button></div>`;
    panel.prepend(intro);
    intro.addEventListener("click", event => {
      const button = event.target.closest("button[data-tab]");
      if (button) activateTab(button.dataset.tab);
    });
  }

  function installTabBridge() {
    document.addEventListener("click", event => {
      const button = event.target.closest("button[data-tab]");
      if (!button) return;
      event.preventDefault();
      activateTab(button.dataset.tab);
    }, true);
  }

  function install() {
    addStyles();
    createDashboardPanel();
    createShell();
    enhanceSettingsPanel();
    installTabBridge();
    renderSubnav("dashboard");
    activateTab("dashboard");
    renderDashboard();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
  document.addEventListener?.("planificador:modules-ready", () => {
    renderDashboard();
    enhanceSettingsPanel();
  });
  window.addEventListener("storage", renderDashboard);

  global.UxDashboard = { install, activateTab, renderDashboard };
})(typeof window !== "undefined" ? window : globalThis);
