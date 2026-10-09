const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizePeriod, sanitizeEntry, aggregateEntries } = require("./profitData");

test("validates periods and source records", () => {
  assert.equal(sanitizePeriod({ name:"April", startDate:"2026-04-01", endDate:"2026-04-30" }).status, "open");
  const nomaPeriod = sanitizePeriod({ name:"April", startDate:"2026-04-01", endDate:"2026-04-30", nomaConnectionId:"farm-a", nomaFeedstockId:"FS-1", nomaFeedstockName:"Brewers grain" });
  assert.deepEqual([nomaPeriod.nomaConnectionId, nomaPeriod.nomaFeedstockId, nomaPeriod.nomaFeedstockName], ["farm-a", "FS-1", "Brewers grain"]);
  assert.equal(sanitizeEntry({ type:"batch", date:"2026-04-02", feedstockKg:100, outputKg:25 }).outputKg, 25);
  assert.throws(() => sanitizeEntry({ type:"cost", date:"bad", category:"fixed", amount:1 }), /valid date/);
});

test("aggregates source records into calculator assumptions", () => {
  const result = aggregateEntries([
    { type:"batch", feedstockKg:100, outputKg:20, frassKg:35 },
    { type:"feedstock", quantityKg:200, totalCost:80 },
    { type:"sale", soldKg:18, productRevenue:180, frassSoldKg:30, frassRevenue:15, byproductRevenue:12, salesFees:5.4 },
    { type:"cost", category:"packaging", amount:10 },
    { type:"cost", category:"fixed", amount:100 },
  ]);
  assert.equal(result.assumptions.feedstockCostPerKg, 0.4);
  assert.equal(result.assumptions.yieldPercent, 20);
  assert.equal(result.assumptions.salePricePerKg, 10);
  assert.equal(result.assumptions.packagingPerKg, 0.5);
  assert.ok(Math.abs(result.assumptions.salesFeePercent - 3) < 1e-10);
  assert.equal(result.assumptions.utilizationPercent, 90);
  assert.equal(result.assumptions.frassYieldPercent, 35);
  assert.equal(result.assumptions.frassSalePricePerKg, 0.5);
});
