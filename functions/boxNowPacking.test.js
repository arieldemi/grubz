const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BOXNOW_MEDIUM_CAPACITY_KG,
  boxNowBaseFeeCents,
  boxNowParcelWeightsGrams,
} = require("./boxNowPacking");

test("every BOX NOW Medium parcel has a 10 kg capacity", () => {
  assert.equal(BOXNOW_MEDIUM_CAPACITY_KG, 10);
});

test("BOX NOW override is charged once per parcel", () => {
  assert.equal(boxNowBaseFeeCents(1000, 2, {
    boxnowFeeOverrideEnabled: true,
    boxnowFeeOverrideCents: 230,
  }), 460);
  assert.equal(boxNowBaseFeeCents(1000, 2, { boxnowFeeOverrideEnabled: false }), 1000);
});

test("BOX NOW parcel payloads use the full 10 kg Medium capacity", () => {
  assert.deepEqual(boxNowParcelWeightsGrams(10_000, 1), [10000]);
  assert.deepEqual(boxNowParcelWeightsGrams(20_000, 2), [10000, 10000]);
});

test("mixed carts also respect the 10 kg parcel maximum", () => {
  assert.deepEqual(boxNowParcelWeightsGrams(12_000, 2), [10000, 2000]);
});
