const test = require("node:test");
const assert = require("node:assert/strict");

const { isVisibleOrderEmailHistoryRecord } = require("./emailHistory");

test("hides the BOX NOW automation claim from customer email history", () => {
  assert.equal(isVisibleOrderEmailHistoryRecord({ type: "boxnow_fulfillment_automatic" }), false);
});

test("keeps the fulfillment email produced by the BOX NOW automation visible", () => {
  assert.equal(isVisibleOrderEmailHistoryRecord({ type: "order_fulfillment" }), true);
});

test("keeps other order emails visible", () => {
  assert.equal(isVisibleOrderEmailHistoryRecord({ type: "customer_purchase_complete" }), true);
  assert.equal(isVisibleOrderEmailHistoryRecord({ type: "order_feedback_request" }), true);
});
