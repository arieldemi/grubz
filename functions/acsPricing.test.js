const test = require("node:test");
const assert = require("node:assert/strict");
const { acsBillableWeightKg, acsPriceCents } = require("./acsPricing");

test("ACS billable weight rounds up to the next half kilogram", () => {
  assert.equal(acsBillableWeightKg(0.1), 0.5);
  assert.equal(acsBillableWeightKg(1), 1);
  assert.equal(acsBillableWeightKg(1.01), 1.5);
});

test("ACS price combines net and VAT as integer cents", () => {
  assert.equal(acsPriceCents(4.2, 1.008), 521);
});

test("ACS rejects an empty package weight", () => {
  assert.throws(() => acsBillableWeightKg(0), /greater than zero/);
});
