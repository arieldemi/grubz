"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { expenseView, parseInvoiceDataUrl, sanitizeExpense } = require("./grubzExpenses");

test("sanitizes a GRUBZ expense", () => {
  assert.deepEqual(sanitizeExpense({ date:"2026-10-07", category:" Utilities ", amount:"12.50", currency:"eur", vendor:" Power Co " }), {
    date:"2026-10-07", category:"Utilities", amount:12.5, currency:"EUR", vendor:"Power Co", reference:"", description:"",
  });
});

test("rejects invalid expense values", () => {
  assert.throws(() => sanitizeExpense({ date:"2026-02-30", category:"x", amount:1 }), /valid/);
  assert.throws(() => sanitizeExpense({ date:"2026-10-07", category:"", amount:1 }), /Category/);
  assert.throws(() => sanitizeExpense({ date:"2026-10-07", category:"x", amount:-1 }), /non-negative/);
});

test("accepts supported invoice data and hides its storage path", () => {
  const invoice = parseInvoiceDataUrl(`data:application/pdf;base64,${Buffer.from("pdf").toString("base64")}`, "bill.pdf");
  assert.equal(invoice.buffer.toString(), "pdf");
  const view = expenseView("e1", { date:"2026-10-07", category:"x", amount:1, invoice:{ fileName:"bill.pdf", contentType:"application/pdf", size:3, path:"private/path" } });
  assert.equal(view.invoice.fileName, "bill.pdf");
  assert.equal(view.invoice.path, undefined);
});
