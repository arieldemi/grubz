function acsBillableWeightKg(weightKg) {
  const numericWeight = Number(weightKg);
  if (!Number.isFinite(numericWeight) || numericWeight <= 0) {
    throw Object.assign(new Error("Enter a package weight greater than zero."), { status: 400 });
  }
  return Math.max(0.5, Math.ceil(numericWeight * 2) / 2);
}

function acsPriceCents(netAmount, vatAmount) {
  const net = Number(netAmount);
  const vat = Number(vatAmount);
  if (!Number.isFinite(net) || !Number.isFinite(vat)) {
    throw new Error("ACS returned an invalid delivery price.");
  }
  return Math.max(0, Math.round((net + vat) * 100));
}

module.exports = { acsBillableWeightKg, acsPriceCents };
