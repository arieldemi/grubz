function validateShipping(shipping) {
  if (!shipping || typeof shipping !== "object") return "Missing shipping";
  const deliveryMethod = String(shipping.deliveryMethod || "boxnow").trim().toLowerCase();
  const requiredValues = {
    name: shipping.name,
    phone: shipping.phone,
    postal: shipping.postal || shipping.postalCode,
    country: shipping.country,
  };
  if (deliveryMethod !== "boxnow") {
    requiredValues.addressLine1 = shipping.addressLine1 || shipping.line1;
    requiredValues.city = shipping.city;
  }
  const missing = Object.entries(requiredValues)
    .filter(([, value]) => !String(value || "").trim())
    .map(([key]) => key);
  return missing.length ? `Missing: ${missing.join(", ")}` : null;
}

module.exports = { validateShipping };
