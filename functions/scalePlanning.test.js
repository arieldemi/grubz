const test = require("node:test");
const assert = require("node:assert/strict");
const model = require("../public/console/scale-planning.js");

test("egg input drives dry and prepared feed requirements", () => {
  const result = model.scenario(model.DEFAULTS, 1);
  assert.equal(result.totalEggsPerBatchG, 50);
  assert.equal(result.batchDryFeedKg, 500);
  assert.equal(result.dryFeedKg, 5000);
  assert.equal(result.preparedFeedKg, 15000);
});

test("total eggs per batch is derived from breeding unit count", () => {
  const result = model.scenario(model.DEFAULTS, 2);
  assert.equal(result.totalEggsPerBatchG, 100);
  assert.equal(result.batchDryFeedKg, 1000);
  assert.equal(result.dryFeedKg, 10000);
});

test("biological rates drive wet and dried larvae output", () => {
  const result = model.scenario(model.DEFAULTS, 1);
  assert.equal(result.wetLarvaeKg, 1215);
  assert.equal(result.driedLarvaeKg, 364.5);
});

test("prepared feed drives frass volume, sales, and handling cost", () => {
  const result = model.scenario(model.DEFAULTS, 1);
  assert.equal(result.frassKg, 2250);
  assert.equal(result.frassSoldKg, 2250);
  assert.equal(result.frassRevenue, 5625);
  assert.equal(result.frassHandlingCost, 180);
  assert.equal(result.revenue, 7447.5);
});

test("affordability never exceeds the available investment", () => {
  const result = model.calculate({ ...model.DEFAULTS, investment: 200000 });
  assert.ok(result.affordable.totalFunding <= result.budget);
  assert.ok(result.next.totalFunding > result.budget);
  assert.equal(result.unallocated, result.budget - result.affordable.totalFunding);
});

test("bottleneck analysis identifies the most utilized production resource", () => {
  const result = model.calculate({ ...model.DEFAULTS, investment: 50000 });
  const analysis = model.analyzeBottlenecks(result);
  assert.equal(analysis.primary.name, "Feed-handling workforce");
  assert.equal(analysis.primary.utilization, 100);
  assert.equal(analysis.primary.headroom, 0);
  assert.match(analysis.primary.resolutions[0], /Add one production FTE/);
  assert.match(analysis.primary.resolutions[1], /177 kg\/staff-hour/);
  assert.deepEqual(analysis.primary.action, {
    key: "minimumProductionFte",
    value: 2,
    label: "Add 1 production FTE",
  });
});

test("bottleneck analysis identifies funding when no setup is affordable", () => {
  const result = model.calculate({ ...model.DEFAULTS, investment: 1 });
  const analysis = model.analyzeBottlenecks(result);
  assert.equal(analysis.primary.name, "Available investment");
  assert.ok(result.gapToNext > 0);
  assert.equal(analysis.primary.action.key, "investment");
  assert.equal(analysis.primary.action.value, result.next.totalFunding);
  assert.ok(Array.isArray(analysis.expansion.resolutions));
  assert.equal(analysis.expansion.action.key, "investment");
});
