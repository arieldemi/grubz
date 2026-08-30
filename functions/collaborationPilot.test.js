"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sanitizePilot, pilotMetrics } = require("./collaborationPilot");

test("sanitizes a three-touchpoint pilot", () => {
  const pilot = sanitizePilot({ enabled: true, memberCount: "20000", commissionPercent: 10, posts: [{ reach: "3000", comments: 12 }] });
  assert.equal(pilot.memberCount, 20000);
  assert.equal(pilot.posts.length, 3);
  assert.equal(pilot.posts[0].reach, 3000);
  assert.equal(pilot.posts[0].comments, 12);
});

test("calculates campaign economics and winner threshold", () => {
  const metrics = pilotMetrics({ orderCount: 12, newCustomerCount: 12, revenueCents: 24000, discountCents: 3000 }, {
    enabled: true, commissionPercent: 10, productCostCents: 2000, shippingCostCents: 500,
    websiteVisits: 150, posts: [{ reach: 3000, reactions: 90, comments: 10 }],
  });
  assert.equal(metrics.commissionCents, 2400);
  assert.equal(metrics.acquisitionCostCents, 7900);
  assert.equal(metrics.customerAcquisitionCostCents, 658);
  assert.equal(metrics.netRevenueCents, 16100);
  assert.equal(metrics.visitConversionRate, 0.08);
  assert.equal(metrics.result, "winner");
});

test("uses the agreed pilot result bands", () => {
  assert.equal(pilotMetrics({ orderCount: 2 }, {}).result, "failure");
  assert.equal(pilotMetrics({ orderCount: 3 }, {}).result, "promising");
  assert.equal(pilotMetrics({ orderCount: 8 }, {}).result, "winner");
});
