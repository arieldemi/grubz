function manualOrderDiscount(input = {}, amountSubtotal = 0, amountShipping = 0) {
  const subtotal = Math.max(0, Math.round(Number(amountSubtotal || 0)));
  const shipping = Math.max(0, Math.round(Number(amountShipping || 0)));
  const discountPercent = Number(input.discountPercent || 0);
  if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
    throw new Error("Discount percentage must be between 0 and 100");
  }
  const fixedDiscount = Math.max(0, Math.round(Number(input.amountDiscount || input.discountCents || 0)));
  const requestedDiscount = discountPercent > 0 ? Math.round(subtotal * discountPercent / 100) : fixedDiscount;
  return {
    discountPercent,
    amountDiscount: Math.min(subtotal + shipping, requestedDiscount),
  };
}

module.exports = { manualOrderDiscount };
