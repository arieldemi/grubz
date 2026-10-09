const test = require("node:test");
const assert = require("node:assert/strict");
const {
  acsFulfillmentForTracking,
  isTerminalAcsTracking,
  normalizeAcsTrackingSummary,
} = require("./acsFulfillment");

test("ACS tracking summary normalizes documented snake-case fields", () => {
  assert.deepEqual(normalizeAcsTrackingSummary({
    voucher_no: 1234567890,
    shipment_status: 2,
    delivery_flag: 0,
    returned_flag: 0,
    delivery_info: "In transit",
  }), {
    voucherNo: "1234567890",
    shipmentStatus: 2,
    deliveryFlag: 0,
    returnedFlag: 0,
    deliveryDate: "",
    expectedDeliveryDate: "",
    deliveryInfo: "In transit",
    nonDeliveryReasonCode: "",
    origin: "",
    destination: "",
  });
});

test("ACS active tracking advances fulfillment to shipped", () => {
  assert.equal(acsFulfillmentForTracking({ shipmentStatus: 2, deliveryFlag: 0, returnedFlag: 0 }), "shipped");
  assert.equal(isTerminalAcsTracking({ shipmentStatus: 2, deliveryFlag: 0, returnedFlag: 0 }), false);
});

test("ACS delivered tracking completes fulfillment and polling", () => {
  assert.equal(acsFulfillmentForTracking({ shipmentStatus: 4, deliveryFlag: 1, returnedFlag: 0 }), "delivered");
  assert.equal(isTerminalAcsTracking({ shipmentStatus: 4, deliveryFlag: 1, returnedFlag: 0 }), true);
});

test("ACS return states stop polling without claiming customer delivery", () => {
  assert.equal(acsFulfillmentForTracking({ shipmentStatus: 6, deliveryFlag: 0, returnedFlag: 0 }), "");
  assert.equal(isTerminalAcsTracking({ shipmentStatus: 7, deliveryFlag: 1, returnedFlag: 1 }), true);
});
