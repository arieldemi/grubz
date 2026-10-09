const test = require("node:test");
const assert = require("node:assert/strict");
const { orthodoxEasterDate, nextOccurrence, sanitizeMarketingEvent, dueReminder, dateKey } = require("./marketingCalendar");

test("calculates Orthodox Easter in Gregorian dates", () => {
  assert.equal(dateKey(orthodoxEasterDate(2026)), "2026-04-12");
  assert.equal(dateKey(orthodoxEasterDate(2027)), "2027-05-02");
});

test("finds the next annual occurrence across the year boundary", () => {
  const event = { recurrence: "annual_fixed", monthDay: "01-02" };
  assert.equal(dateKey(nextOccurrence(event, new Date("2026-10-01T00:00:00Z"))), "2027-01-02");
});

test("does not normalize leap day into March in non-leap years", () => {
  const event = { recurrence: "annual_fixed", monthDay: "02-29" };
  assert.equal(dateKey(nextOccurrence(event, new Date("2027-01-01T00:00:00Z"))), "2028-02-29");
});

test("detects each configured reminder by calendar day", () => {
  const event = { enabled: true, recurrence: "annual_fixed", monthDay: "10-11", reminderDays: [10, 2] };
  assert.deepEqual(dueReminder(event, new Date("2026-10-01T15:00:00Z")), {
    leadDays: 10,
    occurrence: new Date("2026-10-11T00:00:00.000Z"),
    occurrenceKey: "2026-10-11",
  });
  assert.equal(dueReminder(event, new Date("2026-10-02T00:00:00Z")), null);
});

test("sanitizes editable marketing fields", () => {
  const event = sanitizeMarketingEvent({
    title: " World Egg Day ", recurrence: "annual_fixed", monthDay: "10-09",
    categories: ["chicken", "invalid"], audiences: ["chickens"], reminderDays: [2, 10, 2],
  });
  assert.equal(event.title, "World Egg Day");
  assert.deepEqual(event.categories, ["chicken"]);
  assert.deepEqual(event.reminderDays, [10, 2]);
});
