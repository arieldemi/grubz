"use strict";

const ENTRY_TYPES = new Set(["batch", "feedstock", "sale", "cost"]);
const COST_CATEGORIES = new Set([
  "packaging", "labor", "utilities", "logistics", "otherVariable",
  "frassHandling", "fixed", "depreciation", "interest", "investment",
]);

function text(value, max = 180) {
  return String(value || "").trim().slice(0, max);
}

function number(value, name, { required = false, max = 1e9 } = {}) {
  if ((value === "" || value == null) && !required) return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > max) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function date(value, name) {
  const result = text(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    throw new Error(`${name} must be a valid date`);
  }
  return result;
}

function sanitizePeriod(input = {}, existing = {}) {
  const name = text(input.name, 100);
  if (!name) throw new Error("Period name is required");
  const startDate = date(input.startDate, "Start date");
  const endDate = date(input.endDate, "End date");
  if (endDate < startDate) throw new Error("End date must be on or after start date");
  const status = ["open", "reconciled", "closed"].includes(input.status) ? input.status : "open";
  const nomaConnectionId = text(input.nomaConnectionId, 120);
  const nomaFeedstockId = text(input.nomaFeedstockId, 240);
  const nomaFeedstockName = text(input.nomaFeedstockName, 240);
  return {
    ...existing, name, startDate, endDate, status, notes: text(input.notes, 1000),
    nomaConnectionId: nomaFeedstockId ? nomaConnectionId : "",
    nomaFeedstockId,
    nomaFeedstockName: nomaFeedstockId ? nomaFeedstockName : "",
  };
}

function sanitizeEntry(input = {}) {
  const type = text(input.type, 30);
  if (!ENTRY_TYPES.has(type)) throw new Error("Choose a valid record type");
  const base = {
    type,
    date: date(input.date, "Record date"),
    description: text(input.description, 240),
  };
  if (type === "batch") return {
    ...base,
    batchId: text(input.batchId, 80),
    feedstockKg: number(input.feedstockKg, "Processed feedstock", { required: true }),
    outputKg: number(input.outputKg, "Sellable output", { required: true }),
    frassKg: number(input.frassKg, "Frass output"),
    lossKg: number(input.lossKg, "Production loss"),
  };
  if (type === "feedstock") return {
    ...base,
    quantityKg: number(input.quantityKg, "Feedstock quantity", { required: true }),
    totalCost: number(input.totalCost, "Feedstock total cost", { required: true }),
  };
  if (type === "sale") return {
    ...base,
    soldKg: number(input.soldKg, "Kilograms sold", { required: true }),
    productRevenue: number(input.productRevenue, "Net product revenue", { required: true }),
    frassSoldKg: number(input.frassSoldKg, "Frass sold"),
    frassRevenue: number(input.frassRevenue, "Frass revenue"),
    byproductRevenue: number(input.byproductRevenue, "By-product revenue"),
    salesFees: number(input.salesFees, "Sales and payment fees"),
  };
  const category = text(input.category, 30);
  if (!COST_CATEGORIES.has(category)) throw new Error("Choose a valid cost category");
  return { ...base, category, amount: number(input.amount, "Cost amount", { required: true }) };
}

function aggregateEntries(entries = []) {
  const totals = {
    processedFeedstockKg: 0, outputKg: 0, purchasedFeedstockKg: 0, feedstockCost: 0,
    frassKg: 0, soldKg: 0, productRevenue: 0, frassSoldKg: 0, frassRevenue: 0, byproductRevenue: 0, salesFees: 0,
    packaging: 0, labor: 0, utilities: 0, logistics: 0, otherVariable: 0, frassHandling: 0,
    fixed: 0, depreciation: 0, interest: 0, investment: 0,
  };
  entries.forEach(entry => {
    if (entry.type === "batch") {
      totals.processedFeedstockKg += Number(entry.feedstockKg || 0);
      totals.outputKg += Number(entry.outputKg || 0);
      totals.frassKg += Number(entry.frassKg || 0);
    } else if (entry.type === "feedstock") {
      totals.purchasedFeedstockKg += Number(entry.quantityKg || 0);
      totals.feedstockCost += Number(entry.totalCost || 0);
    } else if (entry.type === "sale") {
      totals.soldKg += Number(entry.soldKg || 0);
      totals.productRevenue += Number(entry.productRevenue || 0);
      totals.frassSoldKg += Number(entry.frassSoldKg || 0);
      totals.frassRevenue += Number(entry.frassRevenue || 0);
      totals.byproductRevenue += Number(entry.byproductRevenue || 0);
      totals.salesFees += Number(entry.salesFees || 0);
    } else if (entry.type === "cost" && Object.prototype.hasOwnProperty.call(totals, entry.category)) {
      totals[entry.category] += Number(entry.amount || 0);
    }
  });
  const perOutput = value => totals.outputKg > 0 ? value / totals.outputKg : 0;
  return {
    totals,
    assumptions: {
      feedstockAmountKg: totals.processedFeedstockKg,
      feedstockCostPerKg: totals.purchasedFeedstockKg > 0 ? totals.feedstockCost / totals.purchasedFeedstockKg : 0,
      yieldPercent: totals.processedFeedstockKg > 0 ? totals.outputKg / totals.processedFeedstockKg * 100 : 0,
      utilizationPercent: totals.outputKg > 0 ? Math.min(100, totals.soldKg / totals.outputKg * 100) : 0,
      salePricePerKg: totals.soldKg > 0 ? totals.productRevenue / totals.soldKg : 0,
      frassYieldPercent: totals.processedFeedstockKg > 0 ? totals.frassKg / totals.processedFeedstockKg * 100 : 0,
      frassSalePricePerKg: totals.frassSoldKg > 0 ? totals.frassRevenue / totals.frassSoldKg : 0,
      frassHandlingPerKg: totals.frassKg > 0 ? totals.frassHandling / totals.frassKg : 0,
      otherByproductRevenue: totals.byproductRevenue,
      packagingPerKg: perOutput(totals.packaging),
      laborVariablePerKg: perOutput(totals.labor),
      utilitiesPerKg: perOutput(totals.utilities),
      logisticsPerKg: perOutput(totals.logistics),
      otherVariablePerKg: perOutput(totals.otherVariable),
      salesFeePercent: totals.productRevenue > 0 ? totals.salesFees / totals.productRevenue * 100 : 0,
      fixedCosts: totals.fixed,
      depreciation: totals.depreciation,
      interest: totals.interest,
      initialInvestment: totals.investment,
    },
  };
}

module.exports = { ENTRY_TYPES, COST_CATEGORIES, sanitizePeriod, sanitizeEntry, aggregateEntries };
