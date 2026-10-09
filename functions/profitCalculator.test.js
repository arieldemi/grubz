const test = require("node:test");
const assert = require("node:assert/strict");
const { calculate, sensitivity } = require("../public/console/profit-calculator.js");

test("calculates the full profit waterfall", () => {
  const result = calculate({
    feedstockAmountKg: 1000, feedstockCostPerKg: 0.5, yieldPercent: 50,
    utilizationPercent: 80, salePricePerKg: 10, frassYieldPercent: 0, otherByproductRevenue: 100,
    packagingPerKg: 1, laborVariablePerKg: 0, utilitiesPerKg: 0,
    logisticsPerKg: 0, otherVariablePerKg: 0, salesFeePercent: 5,
    fixedCosts: 500, depreciation: 100, interest: 50, taxPercent: 20,
    initialInvestment: 10000,
  });
  assert.equal(result.sellableKg, 400);
  assert.equal(result.revenue, 4100);
  assert.equal(result.processedFeedstockKg, 800);
  assert.equal(result.variableCosts, 1000);
  assert.equal(result.ebitda, 2600);
  assert.equal(result.netProfit, 1960);
  assert.equal(result.operatingCashFlow, 2060);
  assert.equal(result.contributionMargin, 3100 / 4100);
});

test("shows separate larvae and frass unit economics", () => {
  const result = calculate({
    feedstockAmountKg: 1000, utilizationPercent: 100, yieldPercent: 20,
    salePricePerKg: 10, frassYieldPercent: 40, frassSalePricePerKg: 0.5,
    frassHandlingPerKg: 0.1, fixedCosts: 0, depreciation: 0, interest: 0,
  });
  assert.equal(result.sellableKg, 200);
  assert.equal(result.frassKg, 400);
  assert.equal(result.frassRevenue, 200);
  assert.ok(result.larvaeCostPerKg > 0);
  assert.ok(result.frassCostPerKg > 0);
  assert.equal(result.grossProfit, result.revenue - result.costOfGoodsSold);
});

test("returns no break-even when each additional kg loses money", () => {
  const result = calculate({ salePricePerKg: 1, packagingPerKg: 2 });
  assert.equal(result.breakEvenKg, null);
  assert.equal(result.viable, false);
});

test("sensitivity creates a price by utilization matrix", () => {
  const rows = sensitivity({}, [-0.1, 0, 0.1], [-10, 0, 10]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].results.length, 3);
  assert.ok(rows[2].results[2].netProfit > rows[0].results[0].netProfit);
});
