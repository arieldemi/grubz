const test = require("node:test");
const assert = require("node:assert/strict");

const { boxNowFulfillmentForEvent } = require("./boxNowFulfillment");

test("maps BOX NOW transport events to shipped", () => {
  for (const event of ["shipped", "accepted-to-locker", "picked-up", "picked_up", "in-transit", "in transit", "final-destination"]) {
    assert.equal(boxNowFulfillmentForEvent(event), "shipped");
  }
});

test("maps Accepted To Locker with an In Transit parcel state to shipped", () => {
  assert.equal(boxNowFulfillmentForEvent("accepted-to-locker", { parcelState: "in-transit" }), "shipped");
  assert.equal(boxNowFulfillmentForEvent("accepted", { parcelState: "In Transit" }), "shipped");
});

test("only maps delivered after all parcels are delivered", () => {
  assert.equal(boxNowFulfillmentForEvent("delivered", { allParcelsDelivered: false }), "");
  assert.equal(boxNowFulfillmentForEvent("delivered", { allParcelsDelivered: true }), "delivered");
});

test("does not change fulfillment for non-transport events", () => {
  for (const event of ["", "new", "created", "expired", "returned", "canceled", "missing"]) {
    assert.equal(boxNowFulfillmentForEvent(event), "");
  }
});
