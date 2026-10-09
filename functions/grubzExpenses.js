"use strict";

const ALLOWED_INVOICE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function isoDate(value, name = "date") {
  const text = String(value || "").trim();
  const date = new Date(`${text}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== text) {
    throw Object.assign(new Error(`${name} must be a valid YYYY-MM-DD date`), { status:400 });
  }
  return text;
}

function sanitizeExpense(input = {}) {
  const category = String(input.category || "").trim().slice(0, 100);
  const amount = Number(input.amount);
  const currency = String(input.currency || "EUR").trim().toUpperCase();
  if (!category) throw Object.assign(new Error("Category is required"), { status:400 });
  if (!Number.isFinite(amount) || amount < 0) throw Object.assign(new Error("Amount must be a non-negative number"), { status:400 });
  if (!/^[A-Z]{3}$/.test(currency)) throw Object.assign(new Error("Currency must be a three-letter code"), { status:400 });
  return {
    date:isoDate(input.date), category, amount, currency,
    vendor:String(input.vendor || "").trim().slice(0, 160),
    reference:String(input.reference || "").trim().slice(0, 160),
    description:String(input.description || "").trim().slice(0, 1000),
  };
}

function parseInvoiceDataUrl(dataUrl, fileName = "invoice") {
  const value = String(dataUrl || "");
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || !ALLOWED_INVOICE_TYPES.has(match[1].toLowerCase())) throw Object.assign(new Error("Invoice must be a PDF, JPEG, PNG, or WebP file"), { status:400 });
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) throw Object.assign(new Error("Invoice must not exceed 8 MB"), { status:400 });
  return { fileName:String(fileName || "invoice").trim().slice(0, 180).replace(/[\\/]/g, "_"), contentType:match[1].toLowerCase(), buffer };
}

function expenseView(id, data = {}) {
  return {
    id, date:String(data.date || ""), category:String(data.category || ""), amount:Number(data.amount || 0), currency:String(data.currency || "EUR"),
    vendor:String(data.vendor || ""), reference:String(data.reference || ""), description:String(data.description || ""),
    invoice:data.invoice ? { fileName:String(data.invoice.fileName || "invoice"), contentType:String(data.invoice.contentType || "application/octet-stream"), size:Number(data.invoice.size || 0) } : null,
    createdAt:data.createdAt || null, updatedAt:data.updatedAt || null,
  };
}

module.exports = { ALLOWED_INVOICE_TYPES, expenseView, isoDate, parseInvoiceDataUrl, sanitizeExpense };
