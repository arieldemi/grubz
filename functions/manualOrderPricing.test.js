const test = require("node:test");
const assert = require("node:assert/strict");
const { manualOrderDiscount } = require("./manualOrderPricing");

test("manual order percentage discount applies to product subtotal", () => {
  assert.deepEqual(manualOrderDiscount({ discountPercent: 12.5 }, 8000, 500), { discountPercent: 12.5, amountDiscount: 1000 });
});

test("manual order percentage takes precedence over fixed cents", () => {
  assert.equal(manualOrderDiscount({ discountPercent: 10, amountDiscount: 5000 }, 10000, 0).amountDiscount, 1000);
});

test("manual order discount rejects percentages outside 0 to 100", () => {
  assert.throws(() => manualOrderDiscount({ discountPercent: 101 }, 10000, 0), /between 0 and 100/);
});
