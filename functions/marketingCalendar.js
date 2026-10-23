const DEFAULT_TIME_ZONE = "Europe/Athens";

const ALLOWED_CATEGORIES = new Set([
  "holiday", "name_day", "animal", "chicken", "reptile", "bird", "fish",
  "garden", "sustainability", "food", "seasonal", "culture", "other",
]);
const ALLOWED_AUDIENCES = new Set([
  "general", "chickens", "reptiles", "birds", "fish", "gardeners", "retailers",
]);
const ALLOWED_OBJECTIVES = new Set(["awareness", "engagement", "education", "sales", "community"]);

function dateKey(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const match = String(value || "").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? match[0] : "";
}

function validMonthDay(value) {
  const match = String(value || "").trim().match(/^(\d{2})-(\d{2})$/);
  if (!match) return "";
  const probe = new Date(Date.UTC(2024, Number(match[1]) - 1, Number(match[2])));
  return probe.getUTCMonth() === Number(match[1]) - 1 && probe.getUTCDate() === Number(match[2]) ? match[0] : "";
}

// Meeus Julian algorithm, converted to the Gregorian calendar used in Greece.
function orthodoxEasterDate(year) {
  const a = year % 4;
  const b = year % 7;
  const c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const julianMonth = Math.floor((d + e + 114) / 31);
  const julianDay = ((d + e + 114) % 31) + 1;
  const gregorianOffset = Math.floor(year / 100) - Math.floor(year / 400) - 2;
  return new Date(Date.UTC(year, julianMonth - 1, julianDay + gregorianOffset));
}

function addUtcDays(date, days) {
  const result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + Number(days || 0));
  return result;
}

function eventDateForYear(event = {}, year) {
  const recurrence = String(event.recurrence || "annual_fixed");
  if (recurrence === "one_time") {
    const key = dateKey(event.date);
    return key && Number(key.slice(0, 4)) === year ? new Date(`${key}T00:00:00.000Z`) : null;
  }
  if (recurrence === "orthodox_easter_offset") {
    return addUtcDays(orthodoxEasterDate(year), Math.max(-60, Math.min(60, Number(event.easterOffsetDays || 0))));
  }
  const monthDay = validMonthDay(event.monthDay);
  if (!monthDay) return null;
  const candidate = new Date(`${year}-${monthDay}T00:00:00.000Z`);
  return candidate.getUTCFullYear() === year && `${String(candidate.getUTCMonth() + 1).padStart(2, "0")}-${String(candidate.getUTCDate()).padStart(2, "0")}` === monthDay
    ? candidate : null;
}

function nextOccurrence(event = {}, from = new Date()) {
  const fromKey = dateKey(from);
  const fromYear = Number(fromKey.slice(0, 4));
  for (let year = fromYear; year <= fromYear + 3; year += 1) {
    const occurrence = eventDateForYear(event, year);
    if (occurrence && dateKey(occurrence) >= fromKey) return occurrence;
  }
  return null;
}

function sanitizeMarketingEvent(input = {}, previous = {}) {
  const recurrence = ["annual_fixed", "one_time", "orthodox_easter_offset"].includes(input.recurrence)
    ? input.recurrence : (previous.recurrence || "annual_fixed");
  const title = String(input.title ?? previous.title ?? "").trim().slice(0, 180);
  if (!title) throw Object.assign(new Error("Event title is required."), { status: 400 });
  const monthDay = validMonthDay(input.monthDay ?? previous.monthDay);
  const date = dateKey(input.date ?? previous.date);
  if (recurrence === "annual_fixed" && !monthDay) throw Object.assign(new Error("Choose a valid month and day."), { status: 400 });
  if (recurrence === "one_time" && !date) throw Object.assign(new Error("Choose a valid event date."), { status: 400 });
  const list = (value, allowed) => [...new Set((Array.isArray(value) ? value : []).map(String).filter(item => allowed.has(item)))];
  const reminderDays = [...new Set((Array.isArray(input.reminderDays) ? input.reminderDays : previous.reminderDays || [10, 2])
    .map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 60))].sort((a, b) => b - a);
  return {
    title,
    titleEl: String(input.titleEl ?? previous.titleEl ?? "").trim().slice(0, 180),
    description: String(input.description ?? previous.description ?? "").trim().slice(0, 2000),
    recurrence,
    monthDay: recurrence === "annual_fixed" ? monthDay : "",
    date: recurrence === "one_time" ? date : "",
    easterOffsetDays: recurrence === "orthodox_easter_offset" ? Math.max(-60, Math.min(60, Number(input.easterOffsetDays ?? previous.easterOffsetDays ?? 0))) : 0,
    categories: list(input.categories ?? previous.categories, ALLOWED_CATEGORIES),
    audiences: list(input.audiences ?? previous.audiences, ALLOWED_AUDIENCES),
    objective: ALLOWED_OBJECTIVES.has(input.objective) ? input.objective : (ALLOWED_OBJECTIVES.has(previous.objective) ? previous.objective : "engagement"),
    relevance: ["high", "medium", "experimental"].includes(input.relevance) ? input.relevance : (previous.relevance || "medium"),
    country: String(input.country ?? previous.country ?? "GR").trim().toUpperCase().slice(0, 12),
    sourceUrl: String(input.sourceUrl ?? previous.sourceUrl ?? "").trim().slice(0, 2000),
    sourceLabel: String(input.sourceLabel ?? previous.sourceLabel ?? "").trim().slice(0, 180),
    lastVerified: dateKey(input.lastVerified ?? previous.lastVerified),
    enabled: input.enabled !== undefined ? input.enabled !== false : previous.enabled !== false,
    reminderDays: reminderDays.length ? reminderDays : [2],
    imageUrl: String(input.imageUrl ?? previous.imageUrl ?? "").trim().slice(0, 2000),
    publishLanguage: ["el", "en"].includes(input.publishLanguage) ? input.publishLanguage : (["el", "en"].includes(previous.publishLanguage) ? previous.publishLanguage : "el"),
    imageIterations: (Array.isArray(input.imageIterations) ? input.imageIterations : previous.imageIterations || []).slice(-12).map(item => ({
      imageUrl: String(item?.imageUrl || "").trim().slice(0, 2000),
      prompt: String(item?.prompt || "").trim().slice(0, 4000),
      generatedAt: String(item?.generatedAt || "").trim().slice(0, 40),
    })).filter(item => /^https:\/\//i.test(item.imageUrl)),
    draft: {
      angle: String(input.draft?.angle ?? previous.draft?.angle ?? "").trim().slice(0, 1000),
      angleEn: String(input.draft?.angleEn ?? previous.draft?.angleEn ?? "").trim().slice(0, 1000),
      socialCaption: String(input.draft?.socialCaption ?? previous.draft?.socialCaption ?? "").trim().slice(0, 6000),
      socialCaptionEn: String(input.draft?.socialCaptionEn ?? previous.draft?.socialCaptionEn ?? "").trim().slice(0, 6000),
      storyText: String(input.draft?.storyText ?? previous.draft?.storyText ?? "").trim().slice(0, 2000),
      storyTextEn: String(input.draft?.storyTextEn ?? previous.draft?.storyTextEn ?? "").trim().slice(0, 2000),
      newsletterSubject: String(input.draft?.newsletterSubject ?? previous.draft?.newsletterSubject ?? "").trim().slice(0, 180),
      newsletterSubjectEn: String(input.draft?.newsletterSubjectEn ?? previous.draft?.newsletterSubjectEn ?? "").trim().slice(0, 180),
      cta: String(input.draft?.cta ?? previous.draft?.cta ?? "Shop GRUBZ").trim().slice(0, 300),
      ctaEn: String(input.draft?.ctaEn ?? previous.draft?.ctaEn ?? "Shop GRUBZ").trim().slice(0, 300),
      visualDirection: String(input.draft?.visualDirection ?? previous.draft?.visualDirection ?? "").trim().slice(0, 2000),
      visualDirectionEn: String(input.draft?.visualDirectionEn ?? previous.draft?.visualDirectionEn ?? "").trim().slice(0, 2000),
    },
  };
}

function dueReminder(event, today = new Date()) {
  if (event.enabled === false) return null;
  const todayKey = dateKey(today);
  for (const leadDays of event.reminderDays || [2]) {
    const target = addUtcDays(new Date(`${todayKey}T00:00:00.000Z`), leadDays);
    const occurrence = eventDateForYear(event, target.getUTCFullYear());
    if (occurrence && dateKey(occurrence) === dateKey(target)) return { leadDays, occurrence, occurrenceKey: dateKey(occurrence) };
  }
  return null;
}

module.exports = {
  DEFAULT_TIME_ZONE,
  dateKey,
  orthodoxEasterDate,
  eventDateForYear,
  nextOccurrence,
  sanitizeMarketingEvent,
  dueReminder,
};
