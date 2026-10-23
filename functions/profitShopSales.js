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

function productCategory(item = {}) {
  const identity = `${item.id || item.productId || ""} ${item.name || ""}`.toLowerCase();
  const larvae = identity.includes("happy chicken") || identity.includes("happy-chicken") || identity.includes("larvae");
  const frass = identity.includes("terra") || identity.includes("frass");
  if (larvae && frass) return "bundle";
  if (larvae) return "larvae";
  if (frass) return "frass";
  return "other";
}

function productWeights(item = {}) {
  const quantity = Math.max(1, Number(item.quantity ?? item.qty ?? 1));
  const identity = `${item.id || item.productId || ""} ${item.name || ""}`;
  const larvae = identity.match(/happy[\s-]*chicken[^0-9]{0,40}(\d+(?:[.,]\d+)?)\s*kg\b/i);
  const frass = identity.match(/terra[\s-]*grub[^0-9]{0,40}(\d+(?:[.,]\d+)?)\s*kg\b/i);
  if (larvae || frass) return {
    larvaeKg: larvae ? Number(larvae[1].replace(",", ".")) * quantity : 0,
    frassKg: frass ? Number(frass[1].replace(",", ".")) * quantity : 0,
  };
  const totalKg = weightKg(item);
  const type = productCategory(item);
  return { larvaeKg:type === "larvae" ? totalKg : 0, frassKg:type === "frass" ? totalKg : 0 };
}

function summarizeShopSales(orders = [], options = {}) {
  const vatRate = Math.max(0, Number(options.vatPercent || 0)) / 100;
  const includeCod = options.includeCod === true;
  const totals = { soldKg:0, productRevenue:0, frassSoldKg:0, frassRevenue:0, otherRevenue:0, orderCount:0, skippedOrderCount:0, refundedOrderCount:0 };
  const productMap = new Map();
  const orderEconomics = { unitsSold:0, grossProductRevenue:0, discountTotal:0, netProductRevenue:0, shippingCharged:0 };
  for (const order of orders) {
    const payment = String(order.paymentStatus || "").toLowerCase();
    const status = String(order.status || "").toLowerCase();
    const paid = ["paid", "succeeded", "complete"].includes(payment) || ["paid", "succeeded", "complete"].includes(status);
    const cod = payment === "cash_on_delivery_pending" || String(order.paymentMethod || "").toLowerCase() === "cash_on_delivery";
    if (payment.includes("refund") || status.includes("refund")) { totals.refundedOrderCount++; continue; }
    if (!paid && !(includeCod && cod)) { totals.skippedOrderCount++; continue; }
    const items = Array.isArray(order.items) ? order.items : [];
    const itemSubtotal = items.reduce((sum, item) => sum + amount(item), 0);
    if (!(itemSubtotal > 0)) { totals.skippedOrderCount++; continue; }
    const storedSubtotal = Math.max(0, Number(order.amountSubtotal || itemSubtotal));
    const discount = Math.max(0, Number(order.amountDiscount || 0));
    const discountedFactor = Math.max(0, storedSubtotal - discount) / itemSubtotal;
    const revenueFactor = discountedFactor / (1 + vatRate);
    totals.orderCount++;
    orderEconomics.grossProductRevenue += itemSubtotal / 100;
    orderEconomics.discountTotal += Math.min(itemSubtotal, discount) / 100;
    orderEconomics.netProductRevenue += Math.max(0, storedSubtotal - discount) / 100 / (1 + vatRate);
    orderEconomics.shippingCharged += Math.max(0, Number(order.amountShipping || 0)) / 100;
    for (const item of items) {
      const revenue = amount(item) * revenueFactor / 100;
      const grossRevenue = amount(item) / 100;
      const discountedRevenue = amount(item) * discountedFactor / 100;
      const identity = `${item.id || item.productId || ""} ${item.name || ""}`.toLowerCase();
      const quantity = Math.max(1, Number(item.quantity ?? item.qty ?? 1));
      const weights = productWeights(item);
      const productKey = String(item.id || item.productId || item.name || "Unknown product").trim();
      const product = productMap.get(productKey) || {
        sku:productKey, name:String(item.name || productKey), category:productCategory(item),
        unitsSold:0, larvaeKg:0, frassKg:0, grossRevenue:0, discount:0, netRevenueExVat:0, orderIds:new Set(),
      };
      product.unitsSold += quantity;
      product.larvaeKg += weights.larvaeKg;
      product.frassKg += weights.frassKg;
      product.grossRevenue += grossRevenue;
      product.discount += Math.max(0, grossRevenue - discountedRevenue);
      product.netRevenueExVat += revenue;
      product.orderIds.add(String(order.id || order.orderNumber || totals.orderCount));
      productMap.set(productKey, product);
      orderEconomics.unitsSold += quantity;
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
  const round = value => Math.round(Number(value || 0) * 10000) / 10000;
  totals.products = [...productMap.values()].map(product => {
    const totalKg = product.larvaeKg + product.frassKg;
    return {
      sku:product.sku, name:product.name, category:product.category,
      unitsSold:round(product.unitsSold), orderCount:product.orderIds.size,
      unitWeightKg:product.unitsSold > 0 ? round(totalKg / product.unitsSold) : 0,
      larvaeKgPerUnit:product.unitsSold > 0 ? round(product.larvaeKg / product.unitsSold) : 0,
      frassKgPerUnit:product.unitsSold > 0 ? round(product.frassKg / product.unitsSold) : 0,
      soldKg:round(totalKg), grossRevenue:round(product.grossRevenue), discount:round(product.discount),
      netRevenueExVat:round(product.netRevenueExVat),
      averageGrossUnitPrice:product.unitsSold > 0 ? round(product.grossRevenue / product.unitsSold) : 0,
      averageNetUnitRevenue:product.unitsSold > 0 ? round(product.netRevenueExVat / product.unitsSold) : 0,
    };
  }).sort((a, b) => b.netRevenueExVat - a.netRevenueExVat || a.name.localeCompare(b.name));
  totals.orderEconomics = {
    orderCount:totals.orderCount, unitsSold:round(orderEconomics.unitsSold),
    averageItemsPerOrder:totals.orderCount ? round(orderEconomics.unitsSold / totals.orderCount) : 0,
    averageGrossOrderValue:totals.orderCount ? round(orderEconomics.grossProductRevenue / totals.orderCount) : 0,
    averageDiscountPerOrder:totals.orderCount ? round(orderEconomics.discountTotal / totals.orderCount) : 0,
    averageNetOrderRevenue:totals.orderCount ? round(orderEconomics.netProductRevenue / totals.orderCount) : 0,
    averageShippingCharged:totals.orderCount ? round(orderEconomics.shippingCharged / totals.orderCount) : 0,
    grossProductRevenue:round(orderEconomics.grossProductRevenue), discountTotal:round(orderEconomics.discountTotal),
    netProductRevenue:round(orderEconomics.netProductRevenue), shippingCharged:round(orderEconomics.shippingCharged),
  };
  return totals;
}

module.exports = { summarizeShopSales, weightKg, category, productCategory, productWeights };
