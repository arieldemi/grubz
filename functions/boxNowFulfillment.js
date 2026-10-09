const SHIPPED_EVENTS = new Set([
  "shipped",
  "accepted-to-locker",
  "picked-up",
  "in-transit",
  "transit",
  "final-destination",
]);

function normalizeBoxNowEvent(value = "") {
  return String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
}

function boxNowFulfillmentForEvent(value = "", options = {}) {
  const event = normalizeBoxNowEvent(value);
  if (event === "delivered") return options.allParcelsDelivered === true ? "delivered" : "";
  const parcelState = normalizeBoxNowEvent(options.parcelState);
  return SHIPPED_EVENTS.has(event) || SHIPPED_EVENTS.has(parcelState) ? "shipped" : "";
}

function shouldRetryBoxNowFulfillmentEmail(status = "") {
  return !["sending", "sent"].includes(String(status || "").trim().toLowerCase());
}

module.exports = {
  boxNowFulfillmentForEvent,
  normalizeBoxNowEvent,
  shouldRetryBoxNowFulfillmentEmail,
};
