"use strict";

function finiteNonNegative(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function sanitizePilot(input = {}, existing = {}) {
  const merged = { ...(existing || {}), ...(input || {}) };
  const postInput = Array.isArray(merged.posts) ? merged.posts : [];
  const posts = [0, 1, 2].map(index => {
    const post = postInput[index] || existing.posts?.[index] || {};
    return {
      label: String(post.label || `Post ${index + 1}`).trim().slice(0, 80),
      scheduledAt: String(post.scheduledAt || "").trim().slice(0, 40),
      publishedAt: String(post.publishedAt || "").trim().slice(0, 40),
      reach: Math.round(finiteNonNegative(post.reach)),
      reactions: Math.round(finiteNonNegative(post.reactions)),
      comments: Math.round(finiteNonNegative(post.comments)),
      url: String(post.url || "").trim().slice(0, 500),
    };
  });
  return {
    enabled: merged.enabled === true,
    memberCount: Math.round(finiteNonNegative(merged.memberCount)),
    startsAt: String(merged.startsAt || "").trim().slice(0, 40),
    endsAt: String(merged.endsAt || "").trim().slice(0, 40),
    commissionPercent: Math.min(100, finiteNonNegative(merged.commissionPercent)),
    productCostCents: Math.round(finiteNonNegative(merged.productCostCents)),
    shippingCostCents: Math.round(finiteNonNegative(merged.shippingCostCents)),
    fixedFeeCents: Math.round(finiteNonNegative(merged.fixedFeeCents)),
    websiteVisits: Math.round(finiteNonNegative(merged.websiteVisits)),
    posts,
  };
}

function pilotMetrics(base = {}, pilotInput = {}) {
  const pilot = sanitizePilot(pilotInput);
  const orders = Math.round(finiteNonNegative(base.orderCount));
  const newCustomers = Math.round(finiteNonNegative(base.newCustomerCount));
  const revenueCents = Math.round(finiteNonNegative(base.revenueCents));
  const discountCents = Math.round(finiteNonNegative(base.discountCents));
  const commissionCents = Math.round(revenueCents * pilot.commissionPercent / 100);
  const directCostCents = pilot.productCostCents + pilot.shippingCostCents + pilot.fixedFeeCents;
  const acquisitionCostCents = directCostCents + discountCents + commissionCents;
  const totalReach = pilot.posts.reduce((sum, post) => sum + post.reach, 0);
  const totalEngagements = pilot.posts.reduce((sum, post) => sum + post.reactions + post.comments, 0);
  return {
    ...base,
    averageOrderValueCents: orders ? Math.round(revenueCents / orders) : 0,
    commissionCents,
    directCostCents,
    acquisitionCostCents,
    customerAcquisitionCostCents: newCustomers ? Math.round(acquisitionCostCents / newCustomers) : 0,
    netRevenueCents: revenueCents - commissionCents - discountCents - directCostCents,
    websiteVisits: pilot.websiteVisits,
    visitConversionRate: pilot.websiteVisits ? orders / pilot.websiteVisits : 0,
    totalReach,
    totalEngagements,
    engagementRate: totalReach ? totalEngagements / totalReach : 0,
    result: orders >= 8 ? "winner" : orders >= 3 ? "promising" : "failure",
  };
}

module.exports = { sanitizePilot, pilotMetrics };
