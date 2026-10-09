"use strict";

function amount(item = {}) {
  const total = Number(item.totalAmount ?? item.amountTotal);
  if (Number.isFinite(total) && total >= 0) return total;
  return Math.max(0, Number(item.unitAmount ?? item.amount ?? 0)) * Math.max(1, Number(item.quantity ?? item.qty ?? 1));
}

function weightKg(item = {}) {
  const quantity = Math.max(1, Number(item.quantity ?? item.qty ?? 1));
  const grams = Number(item.weightGrams ?? item.product?.weightGrams ?? 0);
  if (Number.isFinite(grams) && grams > 0) return grams * quantity / 1000;
  const label = `${item.name || ""} ${item.id || item.productId || ""}`;
  const kg = label.match(/(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (kg) return Number(kg[1].replace(",", ".")) * quantity;
  const g = label.match(/(\d+(?:[.,]\d+)?)\s*g(?:r|ram|rams)?\b/i);
  return g ? Number(g[1].replace(",", ".")) * quantity / 1000 : 0;
}

function category(item = {}) {
  const identity = `${item.id || item.productId || ""} ${item.name || ""}`.toLowerCase();
  if (identity.includes("terra") || identity.includes("frass")) return "frass";
  if (identity.includes("happy chicken") || identity.includes("happy-chicken") || identity.includes("larvae")) return "larvae";
  return "other";
}

function summarizeShopSales(orders = [], options = {}) {
  const vatRate = Math.max(0, Number(options.vatPercent || 0)) / 100;
  const includeCod = options.includeCod === true;
  const totals = { soldKg:0, productRevenue:0, frassSoldKg:0, frassRevenue:0, otherRevenue:0, orderCount:0, skippedOrderCount:0 };
  for (const order of orders) {
    const payment = String(order.paymentStatus || "").toLowerCase();
    const status = String(order.status || "").toLowerCase();
    const paid = ["paid", "succeeded", "complete"].includes(payment) || ["paid", "succeeded", "complete"].includes(status);
    const cod = payment === "cash_on_delivery_pending" || String(order.paymentMethod || "").toLowerCase() === "cash_on_delivery";
    if (!paid && !(includeCod && cod)) { totals.skippedOrderCount++; continue; }
    const items = Array.isArray(order.items) ? order.items : [];
    const itemSubtotal = items.reduce((sum, item) => sum + amount(item), 0);
    if (!(itemSubtotal > 0)) { totals.skippedOrderCount++; continue; }
    const storedSubtotal = Math.max(0, Number(order.amountSubtotal || itemSubtotal));
    const discount = Math.max(0, Number(order.amountDiscount || 0));
    const revenueFactor = Math.max(0, storedSubtotal - discount) / itemSubtotal / (1 + vatRate);
    totals.orderCount++;
    for (const item of items) {
      const revenue = amount(item) * revenueFactor / 100;
      const identity = `${item.id || item.productId || ""} ${item.name || ""}`.toLowerCase();
      const quantity = Math.max(1, Number(item.quantity ?? item.qty ?? 1));
      const larvaeBundle = identity.match(/happy[\s-]*chicken[^0-9]{0,40}(\d+(?:[.,]\d+)?)\s*kg\b/i);
      const frassBundle = identity.match(/terra[\s-]*grub[^0-9]{0,40}(\d+(?:[.,]\d+)?)\s*kg\b/i);
      if (larvaeBundle && frassBundle) {
        const larvaeKg = Number(larvaeBundle[1].replace(",", ".")) * quantity;
        const frassKg = Number(frassBundle[1].replace(",", ".")) * quantity;
        const bundleKg = larvaeKg + frassKg;
        totals.soldKg += larvaeKg;
        totals.frassSoldKg += frassKg;
        totals.productRevenue += bundleKg ? revenue * larvaeKg / bundleKg : 0;
        totals.frassRevenue += bundleKg ? revenue * frassKg / bundleKg : 0;
        continue;
      }
      const kg = weightKg(item);
      const type = category(item);
      if (type === "larvae") { totals.soldKg += kg; totals.productRevenue += revenue; }
      else if (type === "frass") { totals.frassSoldKg += kg; totals.frassRevenue += revenue; }
      else totals.otherRevenue += revenue;
    }
  }
  Object.keys(totals).forEach(key => { if (typeof totals[key] === "number") totals[key] = Math.round(totals[key] * 10000) / 10000; });
  return totals;
}

module.exports = { summarizeShopSales, weightKg, category };
