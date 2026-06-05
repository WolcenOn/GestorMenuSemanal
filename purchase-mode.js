(function attachPurchaseMode(global) {
  "use strict";

  const STORAGE = { ingredients: "ingredients", entries: "purchaseEntries" };
  const UNITS = ["g", "kg", "ml", "l", "unidades"];
  let installed = false;
  let stream = null;
  let timer = null;
  let detector = null;

  const $ = id => document.getElementById(id);
  const arr = value => Array.isArray(value) ? value