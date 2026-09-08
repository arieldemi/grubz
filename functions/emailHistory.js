const INTERNAL_ORDER_NOTIFICATION_TYPES = new Set([
  "boxnow_fulfillment_automatic",
]);

function isVisibleOrderEmailHistoryRecord(record = {}) {
  return !INTERNAL_ORDER_NOTIFICATION_TYPES.has(String(record.type || "").trim());
}

module.exports = { isVisibleOrderEmailHistoryRecord };
