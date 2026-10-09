const test = require("node:test");
const assert = require("node:assert/strict");
const {
  acsTrackingUrl,
  missingTrackingPlaceholders,
  orderTrackingDetails,
  shouldRetryAcsFulfillmentEmail,
} = require("./orderTracking");

test("ACS voucher supplies tracking details when mirrored shipping fields are blank", () => {
  assert.deepEqual(orderTrackingDetails({
    shipping: { trackingNumber: "", trackingUrl: "" },
    acsShipment: { voucherNo: "9813329256" },
  }), {
    trackingNumber: "9813329256",
    trackingUrl: acsTrackingUrl("9813329256"),
  });
});

test("explicit shipping tracking details remain authoritative for non-ACS shipments", () => {
  assert.deepEqual(orderTrackingDetails({
    shipping: { trackingNumber: "BOX123", trackingUrl: "https://example.com/BOX123" },
  }), {
    trackingNumber: "BOX123",
    trackingUrl: "https://example.com/BOX123",
  });
});

test("tracking placeholders report exactly which required values are missing", () => {
  const template = "Tracking number: {trackingNumber}\nTracking link: {trackingUrl}";
  assert.deepEqual(missingTrackingPlaceholders(template, {}), ["trackingNumber", "trackingUrl"]);
  assert.deepEqual(missingTrackingPlaceholders(template, { trackingNumber: "123" }), ["trackingUrl"]);
  assert.deepEqual(missingTrackingPlaceholders(template, {
    trackingNumber: "123",
    trackingUrl: "https://example.com/123",
  }), []);
});

test("ACS fulfillment emails retry after a failed or skipped attempt", () => {
  assert.equal(shouldRetryAcsFulfillmentEmail("failed"), true);
  assert.equal(shouldRetryAcsFulfillmentEmail("skipped"), true);
  assert.equal(shouldRetryAcsFulfillmentEmail("sent"), false);
  assert.equal(shouldRetryAcsFulfillmentEmail("sending"), false);
});
