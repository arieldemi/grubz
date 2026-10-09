(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.GrubzProfitCalculator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DEFAULTS = {
    feedstockAmountKg: 1000,
    feedstockCostPerKg: 0.35,
    yieldPercent: 22,
    utilizationPercent: 80,
    salePricePerKg: 7.5,
    frassYieldPercent: 35,
    frassSalePricePerKg: 0.45,
    frassHandlingPerKg: 0.08,
    otherByproductRevenue: 0,
    packagingPerKg: 0.55,
    laborVariablePerKg: 0.8,
    utilitiesPerKg: 0.35,
    logisticsPerKg: 0.3,
    otherVariablePerKg: 0.1,
    salesFeePercent: 3,
    fixedCosts: 700,
    depreciation: 150,
    interest: 0,
    taxPercent: 22,
    initialInvestment: 12000,
  };

  const finite = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const nonNegative = value => Math.max(0, finite(value));
  const percent = value => Math.min(100, nonNegative(value)) / 100;
  const safeDivide = (numerator, denominator) => denominator ? numerator / denominator : null;

  function calculate(raw = {}) {
    const a = { ...DEFAULTS, ...raw };
    const feedstockAmountKg = nonNegative(a.feedstockAmountKg);
    const feedstockCostPerKg = nonNegative(a.feedstockCostPerKg);
    const yieldRate = percent(a.yieldPercent);
    const utilizationRate = percent(a.utilizationPercent);
    const salePricePerKg = nonNegative(a.salePricePerKg);
    const processedFeedstockKg = feedstockAmountKg * utilizationRate;
    const sellableKg = processedFeedstockKg * yieldRate;
    const unusedCapacityKg = feedstockAmountKg * yieldRate - sellableKg;
    const productRevenue = sellableKg * salePricePerKg;
    const frassKg = processedFeedstockKg * percent(a.frassYieldPercent);
    const frassSalePricePerKg = nonNegative(a.frassSalePricePerKg);
    const frassRevenue = frassKg * frassSalePricePerKg;
    const otherByproductRevenue = nonNegative(raw.otherByproductRevenue == null && raw.byproductRevenue != null
      ? raw.byproductRevenue
      : a.otherByproductRevenue);
    const byproductRevenue = frassRevenue + otherByproductRevenue;
    const revenue = productRevenue + byproductRevenue;
    const feedstockCost = processedFeedstockKg * feedstockCostPerKg;
    const perKgConversionCost = [a.packagingPerKg, a.laborVariablePerKg, a.utilitiesPerKg, a.logisticsPerKg, a.otherVariablePerKg]
      .reduce((sum, value) => sum + nonNegative(value), 0);
    const conversionCosts = sellableKg * perKgConversionCost;
    const frassHandlingCosts = frassKg * nonNegative(a.frassHandlingPerKg);
    const salesFees = (productRevenue + frassRevenue) * percent(a.salesFeePercent);
    const variableCosts = feedstockCost + conversionCosts + frassHandlingCosts + salesFees;
    const contribution = revenue - variableCosts;
    const fixedCosts = nonNegative(a.fixedCosts);
    const ebitda = contribution - fixedCosts;
    const depreciation = nonNegative(a.depreciation);
    const ebit = ebitda - depreciation;
    const interest = nonNegative(a.interest);
    const preTaxProfit = ebit - interest;
    const tax = Math.max(0, preTaxProfit) * percent(a.taxPercent);
    const netProfit = preTaxProfit - tax;
    const operatingCashFlow = netProfit + depreciation;
    const initialInvestment = nonNegative(a.initialInvestment);

    // Allocate shared production costs using relative sales value, a transparent
    // method for joint products. Product-specific finishing costs remain direct.
    const larvaeDirectCosts = sellableKg * (nonNegative(a.packagingPerKg) + nonNegative(a.logisticsPerKg));
    const sharedProductionCosts = feedstockCost
      + sellableKg * (nonNegative(a.laborVariablePerKg) + nonNegative(a.utilitiesPerKg) + nonNegative(a.otherVariablePerKg))
      + fixedCosts + depreciation;
    const jointSalesValue = productRevenue + frassRevenue;
    const larvaeAllocationPercent = jointSalesValue > 0 ? productRevenue / jointSalesValue : (sellableKg > 0 ? 1 : 0);
    const frassAllocationPercent = 1 - larvaeAllocationPercent;
    const larvaeProductionCost = sharedProductionCosts * larvaeAllocationPercent + larvaeDirectCosts;
    const frassProductionCost = sharedProductionCosts * frassAllocationPercent + frassHandlingCosts;
    const costOfGoodsSold = sharedProductionCosts + larvaeDirectCosts + frassHandlingCosts;
    const grossProfit = revenue - costOfGoodsSold;

    const variableCostPerKg = safeDivide(variableCosts, sellableKg);
    const contributionPerKg = salePricePerKg * (1 - percent(a.salesFeePercent)) - perKgConversionCost - safeDivide(feedstockCost, sellableKg);
    const recurringFixedCosts = fixedCosts + depreciation + interest;
    const breakEvenKg = contributionPerKg != null && contributionPerKg > 0
      ? Math.max(0, recurringFixedCosts - byproductRevenue) / contributionPerKg
      : null;
    const breakEvenRevenue = breakEvenKg == null ? null : breakEvenKg * salePricePerKg;
    const fullCapacityKg = feedstockAmountKg * yieldRate;
    const marginOfSafetyKg = breakEvenKg == null ? null : sellableKg - breakEvenKg;
    const cashBreakEvenKg = contributionPerKg != null && contributionPerKg > 0
      ? Math.max(0, fixedCosts + interest - byproductRevenue) / contributionPerKg
      : null;

    return {
      assumptions: a,
      processedFeedstockKg,
      sellableKg,
      unusedCapacityKg,
      fullCapacityKg,
      productRevenue,
      frassKg,
      frassRevenue,
      otherByproductRevenue,
      byproductRevenue,
      revenue,
      feedstockCost,
      conversionCosts,
      frassHandlingCosts,
      salesFees,
      variableCosts,
      contribution,
      fixedCosts,
      ebitda,
      depreciation,
      ebit,
      interest,
      preTaxProfit,
      tax,
      netProfit,
      operatingCashFlow,
      sharedProductionCosts,
      larvaeAllocationPercent,
      frassAllocationPercent,
      larvaeProductionCost,
      frassProductionCost,
      larvaeCostPerKg: safeDivide(larvaeProductionCost, sellableKg),
      frassCostPerKg: safeDivide(frassProductionCost, frassKg),
      costOfGoodsSold,
      grossProfit,
      grossMargin: safeDivide(grossProfit, revenue),
      costPerKg: safeDivide(variableCosts + fixedCosts + depreciation + interest, sellableKg),
      variableCostPerKg,
      contributionPerKg,
      contributionMargin: safeDivide(contribution, revenue),
      ebitdaMargin: safeDivide(ebitda, revenue),
      netMargin: safeDivide(netProfit, revenue),
      breakEvenKg,
      breakEvenRevenue,
      cashBreakEvenKg,
      marginOfSafetyKg,
      marginOfSafetyPercent: safeDivide(marginOfSafetyKg, sellableKg),
      capacityNeededPercent: safeDivide(breakEvenKg, fullCapacityKg),
      roi: safeDivide(netProfit, initialInvestment),
      paybackPeriods: operatingCashFlow > 0 ? safeDivide(initialInvestment, operatingCashFlow) : null,
      viable: netProfit > 0 && contributionPerKg > 0,
    };
  }

  function sensitivity(raw, priceChanges = [-0.2, -0.1, 0, 0.1, 0.2], utilizationChanges = [-20, -10, 0, 10, 20]) {
    const base = { ...DEFAULTS, ...raw };
    return utilizationChanges.map(utilizationDelta => ({
      utilizationPercent: Math.min(100, Math.max(0, finite(base.utilizationPercent) + utilizationDelta)),
      results: priceChanges.map(priceDelta => ({
        price: nonNegative(base.salePricePerKg) * (1 + priceDelta),
        priceDelta,
        netProfit: calculate({
          ...base,
          salePricePerKg: nonNegative(base.salePricePerKg) * (1 + priceDelta),
          utilizationPercent: Math.min(100, Math.max(0, finite(base.utilizationPercent) + utilizationDelta)),
        }).netProfit,
      })),
    }));
  }

  return { DEFAULTS, calculate, sensitivity };
});
