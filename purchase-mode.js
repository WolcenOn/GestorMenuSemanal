(function attachPurchaseMode(global) {
  "use strict";

  const STORAGE = {
    ingredients: "ingredients",
    purchaseEntries: "purchaseEntries"
  };

  const DEFAULT_UNITS = ["g", "kg", "ml", "l", "unidades"];
  let installed = false;
  let stream = null;
  let scanTimer = null;
  let detector = null;

  function byId(id) { return document.getElementById(id); }

  function parseJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
