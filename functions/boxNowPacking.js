const BOXNOW_MEDIUM_CAPACITY_KG = 10;

function boxNowBaseFeeCents(parcelAmount, parcelCount, settings = {}) {
  if (settings.boxnowFeeOverrideEnabled === true) {
    const perParcelAmount = Math.max(0, Math.round(Number(settings.boxnowFeeOverrideCents || 0)));
    return perParcelAmount * Math.max(1, Math.round(Number(parcelCount || 0)));
  }
  return Math.max(0, Math.round(Number(parcelAmount || 0)));
}

function boxNowParcelWeightsGrams(totalWeightGrams, parcelCount) {
  const total = Math.max(0, Math.round(Number(totalWeightGrams || 0)));
  const count = Math.max(0, Math.round(Number(parcelCount || 0)));
  const weights = [];
  let remainingWeight = total;
  for (let index = 0; index < count; index += 1) {
    const weight = index === count - 1
      ? remainingWeight
      : Math.min(BOXNOW_MEDIUM_CAPACITY_KG * 1000, remainingWeight);
    weights.push(Math.max(1, weight));
    remainingWeight = Math.max(0, remainingWeight - weight);
  }
  return weights;
}

module.exports = {
  BOXNOW_MEDIUM_CAPACITY_KG,
  boxNowBaseFeeCents,
  boxNowParcelWeightsGrams,
};
