"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { dateFromOrderValue, formatOrderShippingDate } = require("./orderEmailTemplateVars");

test("formats an upcoming shipping date for each supported email language", () => {
  assert.equal(formatOrderShippingDate("2026-10-12", "en"), "12 October 2026");
  assert.equal(formatOrderShippingDate("2026-10-12", "el"), "12 Οκτωβρίου 2026");
});

test("accepts Firestore timestamp-shaped values and rejects invalid dates", () => {
  assert.equal(dateFromOrderValue({ seconds: 1791763200 }).toISOString(), "2026-10-12T00:00:00.000Z");
  assert.equal(formatOrderShippingDate("not-a-date", "en"), "");
});
