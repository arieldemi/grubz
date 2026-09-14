const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BOXNOW_MEDIUM_CAPACITY_KG,
  boxNowBaseFeeCents,
  boxNowParcelWeightsGrams,
} = require("./boxNowPacking");

test("every BOX NOW Medium parcel has a 7 kg capacity", () => {
  assert.equal(BOXNOW_MEDIUM_CAPACITY_KG, 7);
});

test("BOX NOW override is charged once per parcel", () => {
  assert.equal(boxNowBaseFeeCents(1000, 2, {
    boxnowFeeOverrideEnabled: true,
    boxnowFeeOverrideCents: 230,
  }), 460);
  assert.equal(boxNowBaseFeeCents(1000, 2, { boxnowFeeOverrideEnabled: false }), 1000);
});

test("every 10 kg order payload uses 7 kg and 3 kg parcel weights", () => {
  assert.deepEqual(boxNowParcelWeightsGrams(10_000, 2), [7000, 3000]);
  assert.deepEqual(boxNowParcelWeightsGrams(20_000, 3), [7000, 7000, 6000]);
});

test("mixed carts also respect the 7 kg parcel maximum", () => {
  assert.deepEqual(boxNowParcelWeightsGrams(12_000, 2), [7000, 5000]);
});
