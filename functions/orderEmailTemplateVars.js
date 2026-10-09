"use strict";

function dateFromOrderValue(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value.toDate === "function") return dateFromOrderValue(value.toDate());
  if (typeof value === "object" && Number.isFinite(Number(value._seconds ?? value.seconds))) {
    return new Date(Number(value._seconds ?? value.seconds) * 1000);
  }
  const raw = String(value).trim();
  if (!raw) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? new Date(`${raw}T12:00:00Z`) : new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatOrderShippingDate(value, language = "en") {
  const date = dateFromOrderValue(value);
  if (!date) return "";
  return new Intl.DateTimeFormat(language === "el" ? "el-GR" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Athens",
  }).format(date);
}

module.exports = { dateFromOrderValue, formatOrderShippingDate };
