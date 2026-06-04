/*
 * Robust remote pack preview for PlanificadorComidas.
 * Load after index.html main script. It intercepts clicks on "Vista previa"
 * buttons and builds its own pack list from packs/index.json or the GitHub API.
 * It also lets users select individual recipes from each pack before import.
 */
(function attachPackPreviewFix(global) {
  "use strict";

  const recipeSelections = new Map();

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(text) {
    return String(text ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function cleanRemotePath(path) {
    return String(path || "packs/recetas").trim().replace(/^\/+|\/+$/g, "") || "packs/recetas";
  }

  function inferGitHubRepoFromLocation() {
    const host = window.location.hostname;
    const parts = window.location.pathname.split("/").filter(Boolean);
    if (!host.endsWith("github.io")) return { owner: "", repo: "" };
    const owner = host.replace(".github.io", "");
    const repo = parts[0] || `${owner}.github.io`;
    return { owner, repo };
  }

  function encodePath(path) {
    return cleanRemotePath(path).split("/").map(encodeURIComponent).join("/");
  }

  function resolvePackUrl(url, basePath) {
    const raw = String(url || "").trim();
    if (!raw) return "";

    if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\//i.test(raw)) {
      return raw
        .replace("https://github.com/", "https://raw.githubusercontent.com/")
        .replace("/blob/", "/");
    }

    if (/^https?:\/\//i.test(raw)) return raw;

    const clean = raw.replace(/^\.\//, "").replace(/^\/+/, "");
    if (clean.includes("/")) return encodePath(clean);
    return `${encodePath(basePath)}/${encodeURIComponent(clean)}`;
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status} al leer ${url}`);
    try {
      return await response.json();
    } catch {
      throw new Error(`El archivo no contiene JSON valido: ${url}`);
    }
  }

  function getConfig() {
    const inferred = inferGitHubRepoFromLocation();
    return {
      path: cleanRemotePath(byId("remotePacksPath")?.value || localStorage.getItem("remotePacksPath") || "packs/recetas"),
      owner: byId("remoteRepoOwner")?.value.trim() || localStorage.getItem("remoteRepoOwner") || inferred.owner,
      repo: byId("remoteRepoName")?.value.trim() || localStorage.getItem("remoteRepoName") || inferred.repo,
      branch: byId("remoteRepoBranch")?.value.trim() || localStorage.getItem("remoteRepoBranch") || "main"
    };
  }

  function normalizeIndexItem(item, config) {
    if (typeof item === "string") {
      return {
        name: item.replace(/\.json$/i, ""),
        description: "Archivo JSON del indice local",
        filename: item,
        url: resolvePackUrl(item, config.path)
      };
    }

    if (!item || typeof item !== "object") return null;
    const filename = item.file || item.filename || item.path || item.name || "pack.json";
    return {
      name: item.name || item.title || String(filename).replace(/\.json$/i, "") || "Pack",
      description: item.description || item.descripcion || "Archivo JSON del indice local",
      filename,
      url: resolvePackUrl(item.url || filename, config.path)
    };
  }

  async function loadPackList() {
    const config = getConfig();

    try {
      const index = await fetchJson("packs/index.json");
      const files = Array.isArray(index) ? index : (index.files || index.packs || index.recipes || []);
      const packs = files.map(item => normalizeIndexItem(item, config)).filter(item => item && item.url && item.url.toLowerCase().includes(".json"));
      if (packs.length) return packs;
    } catch {
      // Fall back to GitHub API below.
    }

    if (!config.owner || !config.repo) throw new Error("Faltan usuario o repositorio para buscar packs.");

    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/contents/${encodePath(config.path)}?ref=${encodeURIComponent(config.branch)}`;
    const contents = await fetchJson(apiUrl);
    return (Array.isArray(contents) ? contents : [])
      .filter(item => item && item.type === "file" && String(item.name || "").toLowerCase().endsWith(".json"))
      .map(item => ({
        name: String(item.name).replace(/\.json$/i, ""),
        description: "Archivo JSON del repositorio",
        filename: item.name,
        url: item.download_url || resolvePackUrl(item.name, config.path)
      }));
  }

  function extractDishes(data) {
    if (Array.isArray(data)) return data;
    if (data && Array.isArray(data.dishes)) return data.dishes;
    if (data && Array.isArray(data.platos)) return data.platos;
    if (data && Array.isArray(data.recipes)) return data.recipes;
    if (data && Array.isArray(data.recetas)) return data.recetas;
    return [];
  }

  function setDishes(data, dishes) {
    if (Array.isArray(data)) return dishes;
    if (data && Array.isArray(data.dishes)) return { ...data, dishes };
    if (data && Array.isArray(data.platos)) return { ...data, platos: dishes };
    if (data && Array.isArray(data.recipes)) return { ...data, recipes: dishes };
    if (data && Array.isArray(data.recetas)) return { ...data, recetas: dishes };
    return { ...(data || {}), dishes };
  }

  function dishIngredientsCount(dish) {
    const rows = dish && (dish.ingredients || dish.ingredientes || dish.recipe || dish.receta);
    return Array.isArray(rows) ? rows.length : 0;
  }

  function ensureSelection(pack, dishes) {
    if (!recipeSelections.has(pack.url)) {
      recipeSelections.set(pack.url, new Set(dishes.map((_, index) => index)));
    }
    return recipeSelections.get(pack.url);
  }

  function selectedCount(pack, dishes) {
    return ensureSelection(pack, dishes).size;
  }

  function updateModalSelectedCount() {
    const modal = document.querySelector(".pack-preview-modal");
    if (!modal) return;
    const count = modal.querySelectorAll(".pack-recipe-check:checked").length;
    const total = modal.querySelectorAll(".pack-recipe-check").length;
    const output = modal.querySelector("[data-selected-count]");
    if (output) output.textContent = `${count}/${total} receta/s seleccionadas`;
  }

  function buildPreviewHtml(pack, data) {
    const dishes = extractDishes(data);
    const title = data.name || data.nombre || data.title || pack.name || "Pack";
    const description = data.description || data.descripcion || pack.description || "Sin descripcion";
    const selected = ensureSelection(pack, dishes);

    return `
      <div class="pack-preview-overlay" role="dialog" aria-modal="true">
        <div class="pack-preview-modal" data-pack-url="${escapeHtml(pack.url)}">
          <div class="item-top">
            <div>
              <h2>${escapeHtml(title)}</h2>
              <p class="muted">${escapeHtml(description)}</p>
              <p><strong>${dishes.length}</strong> plato/s encontrados · <span data-selected-count>${selected.size}/${dishes.length} receta/s seleccionadas</span></p>
              <p class="muted">${escapeHtml(pack.filename || pack.url)}</p>
            </div>
            <button type="button" class="ghost" data-pack-preview-close>Cerrar</button>
          </div>
          <div class="actions" style="margin-bottom:12px">
            <button type="button" class="ghost" data-pack-select-all>Seleccionar todas</button>
            <button type="button" class="ghost" data-pack-select-none>Desmarcar todas</button>
          </div>
          <div class="list">
            ${dishes.length ? dishes.map((dish, index) => `
              <label class="item pack-recipe-row">
                <input type="checkbox" class="pack-recipe-check" data-pack-url="${escapeHtml(pack.url)}" data-dish-index="${index}" ${selected.has(index) ? "checked" : ""} />
                <div>
                  <div class="item-top">
                    <div>
                      <div class="item-name">${escapeHtml(dish.name || dish.nombre || "Plato")}</div>
                      <div class="muted">${escapeHtml(dish.category || dish.categoria || "Sin categoria")} · ${escapeHtml(dish.prepTime || dish.tiempo || "Tiempo no indicado")} · ${escapeHtml(dish.difficulty || dish.dificultad || "Dificultad no indicada")}</div>
                      <div class="muted">${dishIngredientsCount(dish)} ingrediente/s</div>
                    </div>
                    <span class="badge favorite">Importar</span>
                  </div>
                  ${dish.notes || dish.notas ? `<p class="muted">${escapeHtml(String(dish.notes || dish.notas).slice(0, 320))}${String(dish.notes || dish.notas).length > 320 ? "..." : ""}</p>` : ""}
                </div>
              </label>`).join("") : '<div class="empty">No se han encontrado platos en este pack.</div>'}
          </div>
        </div>
      </div>`;
  }

  function ensureStyles() {
    if (document.getElementById("packPreviewFixStyles")) return;
    const style = document.createElement("style");
    style.id = "packPreviewFixStyles";
    style.textContent = `
      .pack-preview-overlay {
        position: fixed;
        inset: 0;
        z-index: 9999;
        background: rgba(8, 31, 35, 0.5);
        padding: 18px;
        overflow: auto;
      }
      .pack-preview-modal {
        width: min(920px, 100%);
        margin: 40px auto;
        background: white;
        border: 1px solid var(--border, #cfe7df);
        border-radius: 22px;
        padding: 18px;
        box-shadow: 0 18px 50px rgba(0, 0, 0, 0.25);
      }
      .pack-preview-modal h2 { margin: 0 0 8px; }
      .pack-recipe-row {
        display: grid;
        grid-template-columns: auto 1fr;
        gap: 12px;
        cursor: pointer;
      }
      .pack-recipe-row input {
        width: auto;
        margin-top: 6px;
        transform: scale(1.18);
      }
    `;
    document.head.appendChild(style);
  }

  function closePreview() {
    document.querySelectorAll(".pack-preview-overlay").forEach(node => node.remove());
  }

  async function previewPackByIndex(index) {
    ensureStyles();
    const packs = await loadPackList();
    const pack = packs[Number(index)];
    if (!pack) throw new Error("No encuentro ese pack en la lista cargada.");
    const data = await fetchJson(pack.url);
    closePreview();
    const wrapper = document.createElement("div");
    wrapper.innerHTML = buildPreviewHtml(pack, data);
    document.body.appendChild(wrapper.firstElementChild);
  }

  function filterPackDataForSelection(pack, data) {
    const dishes = extractDishes(data);
    const selected = ensureSelection(pack, dishes);
    const filtered = dishes.filter((_, index) => selected.has(index));
    return setDishes(data, filtered);
  }

  async function importSelectedPacks() {
    if (typeof global.importDishesData !== "function") {
      throw new Error("La funcion de importacion de platos no esta disponible todavia.");
    }

    const selectedPackIndexes = Array.from(document.querySelectorAll(".remote-pack-check:checked"))
      .map(input => Number(input.dataset.index))
      .filter(index => Number.isInteger(index));

    if (!selectedPackIndexes.length) {
      alert("Marca al menos un pack para importar.");
      return;
    }

    const packs = await loadPackList();
    let added = 0;
    let updated = 0;
    let createdIngredients = 0;
    let skipped = 0;

    for (const index of selectedPackIndexes) {
      const pack = packs[index];
      if (!pack) continue;
      const data = await fetchJson(pack.url);
      const filtered = filterPackDataForSelection(pack, data);
      const dishesToImport = extractDishes(filtered);
      if (!dishesToImport.length) {
        skipped += 1;
        continue;
      }
      const result = global.importDishesData(filtered, true);
      added += result.addedDishes || 0;
      updated += result.updatedDishes || 0;
      createdIngredients += result.addedIngredients || 0;
    }

    if (typeof global.renderAll === "function") global.renderAll();
    if (typeof global.switchTab === "function") global.switchTab("dishes");
    alert(`Packs importados. Platos añadidos: ${added}. Platos actualizados: ${updated}. Ingredientes creados: ${createdIngredients}.${skipped ? ` Packs sin recetas seleccionadas: ${skipped}.` : ""}`);
  }

  function getPreviewIndexFromButton(button) {
    const onclick = button.getAttribute("onclick") || "";
    const match = onclick.match(/previewRemotePack\((\d+)\)/);
    return match ? Number(match[1]) : null;
  }

  function installPreviewPatch() {
    document.addEventListener("change", event => {
      const check = event.target.closest(".pack-recipe-check");
      if (!check) return;
      const packUrl = check.dataset.packUrl;
      const index = Number(check.dataset.dishIndex);
      if (!packUrl || !Number.isInteger(index)) return;
      const selected = recipeSelections.get(packUrl) || new Set();
      if (check.checked) selected.add(index);
      else selected.delete(index);
      recipeSelections.set(packUrl, selected);
      updateModalSelectedCount();
    }, true);

    document.addEventListener("click", event => {
      const close = event.target.closest("[data-pack-preview-close]");
      if (close) {
        closePreview();
        return;
      }

      const selectAll = event.target.closest("[data-pack-select-all]");
      const selectNone = event.target.closest("[data-pack-select-none]");
      if (selectAll || selectNone) {
        const modal = event.target.closest(".pack-preview-modal");
        const packUrl = modal?.dataset.packUrl;
        const checks = Array.from(modal?.querySelectorAll(".pack-recipe-check") || []);
        const selected = new Set();
        checks.forEach(check => {
          check.checked = Boolean(selectAll);
          if (selectAll) selected.add(Number(check.dataset.dishIndex));
        });
        if (packUrl) recipeSelections.set(packUrl, selected);
        updateModalSelectedCount();
        return;
      }

      const importButton = event.target.closest("#importSelectedPacksBtn");
      if (importButton) {
        event.preventDefault();
        event.stopImmediatePropagation();
        importButton.disabled = true;
        const originalText = importButton.textContent;
        importButton.textContent = "Importando...";
        importSelectedPacks()
          .catch(error => alert(`No se pudieron importar los packs: ${error.message}`))
          .finally(() => {
            importButton.disabled = false;
            importButton.textContent = originalText;
          });
        return;
      }

      const button = event.target.closest('button[onclick^="previewRemotePack"]');
      if (!button) return;
      const index = getPreviewIndexFromButton(button);
      if (index === null) return;

      event.preventDefault();
      event.stopImmediatePropagation();
      button.disabled = true;
      const originalText = button.textContent;
      button.textContent = "Cargando...";

      previewPackByIndex(index)
        .catch(error => alert(`No se pudo mostrar la vista previa: ${error.message}`))
        .finally(() => {
          button.disabled = false;
          button.textContent = originalText;
        });
    }, true);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installPreviewPatch);
  else installPreviewPatch();

  global.PackPreviewFix = {
    loadPackList,
    previewPackByIndex,
    filterPackDataForSelection,
    importSelectedPacks,
    recipeSelections
  };
})(typeof window !== "undefined" ? window : globalThis);
