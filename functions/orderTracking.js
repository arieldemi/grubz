function acsTrackingUrl(voucherNo) {
  const trackingNumber = String(voucherNo || "").trim();
  return trackingNumber
    ? `https://www.acscourier.net/en/quick-access/non-registered-users/track-and-trace/?trackingNumber=${encodeURIComponent(trackingNumber)}`
    : "";
}

function orderTrackingDetails(order = {}) {
  const shipping = order.shipping || {};
  const acsVoucherNo = String(order.acsShipment?.voucherNo || "").trim();
  const trackingNumber = String(shipping.trackingNumber || acsVoucherNo || "").trim();
  const trackingUrl = String(
    shipping.trackingUrl || (acsVoucherNo ? acsTrackingUrl(acsVoucherNo) : "")
  ).trim();
  return { trackingNumber, trackingUrl };
}

function missingTrackingPlaceholders(templateText = "", tracking = {}) {
  const text = String(templateText || "");
  const missing = [];
  if (/\{\s*trackingNumber\s*\}/i.test(text) && !String(tracking.trackingNumber || "").trim()) {
    missing.push("trackingNumber");
  }
  if (/\{\s*trackingUrl\s*\}/i.test(text) && !String(tracking.trackingUrl || "").trim()) {
    missing.push("trackingUrl");
  }
  return missing;
}

function shouldRetryAcsFulfillmentEmail(status = "") {
  return ["failed", "skipped"].includes(String(status || "").trim().toLowerCase());
}

module.exports = {
  acsTrackingUrl,
  missingTrackingPlaceholders,
  orderTrackingDetails,
  shouldRetryAcsFulfillmentEmail,
};
