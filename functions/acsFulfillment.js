function acsTrackingValue(row = {}, ...keys) {
  for (const key of keys) {
    if (row[key] != null && String(row[key]).trim() !== "") return row[key];
  }
  return "";
}

function normalizeAcsTrackingSummary(row = {}) {
  const optionalNumber = value => String(value).trim() === "" ? null : Number(value);
  const shipmentStatus = optionalNumber(acsTrackingValue(row, "shipment_status", "Shipment_Status"));
  const deliveryFlag = optionalNumber(acsTrackingValue(row, "delivery_flag", "Delivery_Flag"));
  const returnedFlag = optionalNumber(acsTrackingValue(row, "returned_flag", "Returned_Flag"));
  return {
    voucherNo: String(acsTrackingValue(row, "voucher_no", "Voucher_No")).trim(),
    shipmentStatus: Number.isFinite(shipmentStatus) ? shipmentStatus : null,
    deliveryFlag: Number.isFinite(deliveryFlag) ? deliveryFlag : null,
    returnedFlag: Number.isFinite(returnedFlag) ? returnedFlag : null,
    deliveryDate: String(acsTrackingValue(row, "delivery_date", "Delivery_Date")).trim(),
    expectedDeliveryDate: String(acsTrackingValue(row, "delivery_date_expected", "Delivery_Date_Expected")).trim(),
    deliveryInfo: String(acsTrackingValue(row, "delivery_info", "Delivery_Info")).trim(),
    nonDeliveryReasonCode: String(acsTrackingValue(row, "non_delivery_reason_code", "Non_Delivery_Reason_Code")).trim(),
    origin: String(acsTrackingValue(row, "acs_station_origin_descr", "ACS_Station_Origin_Descr")).trim(),
    destination: String(acsTrackingValue(row, "acs_station_destination_descr", "ACS_Station_Destination_Descr")).trim(),
  };
}

function acsFulfillmentForTracking(summary = {}) {
  if (summary.returnedFlag === 1 || [6, 7].includes(summary.shipmentStatus)) return "";
  if (summary.deliveryFlag === 1 || summary.shipmentStatus === 4) return "delivered";
  return summary.shipmentStatus != null ? "shipped" : "";
}

function isTerminalAcsTracking(summary = {}) {
  return summary.deliveryFlag === 1 || summary.returnedFlag === 1 || [4, 7].includes(summary.shipmentStatus);
}

module.exports = {
  acsFulfillmentForTracking,
  isTerminalAcsTracking,
  normalizeAcsTrackingSummary,
};
