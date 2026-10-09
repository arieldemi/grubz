"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchNomaCredentialInfo, fetchNomaExpenseInvoice, fetchNomaExpenses, fetchNomaInventorySummary, fetchNomaProductionSummary } = require("./nomaFlowClient");

function payload(overrides = {}) {
  return { schemaVersion:1, generatedAt:"2026-09-19T12:00:00Z", scope:{ tenantId:"t", farmId:"f" }, period:{ startDate:"2026-09-01", endDate:"2026-09-30" }, totals:{ processedFeedstockKg:30, sellableOutputKg:8.7, productionLossKg:21.3, feedstockCost:10, packagingCost:2, directLaborCost:3, utilitiesCost:1, otherVariableCost:0 }, lots:[], nextCursor:null, ...overrides };
}

test("discovers credential scope without putting the key in the URL", async () => {
  let captured;
  const credential = await fetchNomaCredentialInfo({ baseUrl:"https://noma.example", apiKey:"secret", retries:0, fetchImpl:async (url, options) => {
    captured = { url:String(url), options };
    return { ok:true, json:async () => ({ schemaVersion:1, credential:{ name:"Farm sync", clientId:"farm-sync", scope:{ tenantId:"tenant-a", farmId:"farm-a" }, allowedScopes:["production:read"], expiresAt:null } }) };
  } });
  assert.deepEqual(credential.scope, { tenantId:"tenant-a", farmId:"farm-a" });
  assert.equal(captured.options.headers.Authorization, "Bearer secret");
  assert.doesNotMatch(captured.url, /secret|tenant-a|farm-a/);
});

test("sends the secret only as a bearer credential and never tenant/farm query inputs", async () => {
  let captured;
  await fetchNomaProductionSummary({ baseUrl:"https://noma.example", apiKey:"secret", startDate:"2026-09-01", endDate:"2026-09-30", retries:0, fetchImpl:async (url, options) => { captured={ url:String(url), options }; return { ok:true, json:async()=>payload() }; } });
  assert.equal(captured.options.headers.Authorization, "Bearer secret");
  assert.doesNotMatch(captured.url, /tenantId|farmId|secret/);
});

test("validates dates before making a request", async () => {
  await assert.rejects(fetchNomaProductionSummary({ baseUrl:"https://noma.example", apiKey:"x", startDate:"2026-09-31", endDate:"2026-10-01" }), /invalid/);
  await assert.rejects(fetchNomaProductionSummary({ baseUrl:"https://noma.example", apiKey:"x", startDate:"2026-10-02", endDate:"2026-10-01" }), /must not be after/);
});

test("rejects unsupported schemas and malformed lots", async () => {
  await assert.rejects(fetchNomaProductionSummary({ baseUrl:"https://noma.example", apiKey:"x", startDate:"2026-09-01", endDate:"2026-09-30", retries:0, fetchImpl:async()=>({ ok:true, json:async()=>payload({ schemaVersion:2 }) }) }), /unsupported schema/);
  await assert.rejects(fetchNomaProductionSummary({ baseUrl:"https://noma.example", apiKey:"x", startDate:"2026-09-01", endDate:"2026-09-30", retries:0, fetchImpl:async()=>({ ok:true, json:async()=>payload({ lots:[{ lotId:"x" }] }) }) }), /invalid production lot/);
});

test("follows opaque cursors and combines lot pages", async () => {
  const urls=[];
  const responses=[payload({ lots:[{ lotId:"a", updatedAt:"2026-09-01T00:00:00Z", revision:1, parents:[] }], nextCursor:"opaque" }), payload({ lots:[{ lotId:"b", updatedAt:"2026-09-02T00:00:00Z", revision:2, parents:[] }] })];
  const result = await fetchNomaProductionSummary({ baseUrl:"https://noma.example", apiKey:"x", startDate:"2026-09-01", endDate:"2026-09-30", retries:0, fetchImpl:async url=>{ urls.push(String(url)); return { ok:true, json:async()=>responses.shift() }; } });
  assert.deepEqual(result.lots.map(lot=>lot.lotId), ["a","b"]);
  assert.match(urls[1], /cursor=opaque/);
});

test("retries transient upstream failures", async () => {
  let calls=0;
  const result = await fetchNomaProductionSummary({ baseUrl:"https://noma.example", apiKey:"x", startDate:"2026-09-01", endDate:"2026-09-30", retries:1, fetchImpl:async()=>{ calls++; return calls===1 ? { ok:false, status:503, json:async()=>({ error:"busy" }) } : { ok:true, json:async()=>payload() }; } });
  assert.equal(result.schemaVersion, 1);
  assert.equal(calls, 2);
});

test("loads credential-scoped NOMA inventory without tenant or farm query parameters", async () => {
  let captured;
  const result = await fetchNomaInventorySummary({ baseUrl:"https://noma.example", apiKey:"secret", retries:0, fetchImpl:async (url, options) => {
    captured = { url:String(url), options };
    return { ok:true, json:async () => ({ schemaVersion:1, generatedAt:"2026-09-20T00:00:00Z", scope:{ tenantId:"t", farmId:"f" }, items:[{ id:"INV-1", name:"Happy Chicken", category:"Finished Product", stock:15, unit:"kg" }] }) };
  } });
  assert.equal(result.items[0].stock, 15);
  assert.equal(captured.options.headers.Authorization, "Bearer secret");
  assert.doesNotMatch(captured.url, /tenantId|farmId|secret/);
});

test("lists credential-scoped NOMA expenses", async () => {
  let captured;
  const result = await fetchNomaExpenses({ baseUrl:"https://noma.example", apiKey:"secret", startDate:"2026-09-01", endDate:"2026-09-30", retries:0, fetchImpl:async (url, options) => {
    captured = { url:String(url), options };
    return { ok:true, json:async () => ({ schemaVersion:1, scope:{ tenantId:"t", farmId:"f" }, expenses:[{ id:"e1", date:"2026-09-05", category:"utilities", amount:12.5, currency:"EUR" }], totals:{ amount:12.5, currency:"EUR" } }) };
  } });
  assert.equal(result.expenses[0].id, "e1");
  assert.match(captured.url, /startDate=2026-09-01/);
  assert.doesNotMatch(captured.url, /tenantId|farmId|secret/);
  assert.equal(captured.options.headers.Authorization, "Bearer secret");
});

test("rejects attempts to mutate NOMA expenses", async () => {
  await assert.rejects(fetchNomaExpenses({ baseUrl:"https://noma.example", apiKey:"secret", method:"POST" }), /read-only/);
});

test("downloads a credential-scoped NOMA expense invoice", async () => {
  let captured;
  const invoice = await fetchNomaExpenseInvoice({ baseUrl:"https://noma.example", apiKey:"secret", expenseId:"expense 1", fetchImpl:async (url, options) => {
    captured = { url:String(url), options };
    return { ok:true, headers:{ get:name => name === "content-type" ? "application/pdf" : name === "content-disposition" ? 'attachment; filename="invoice.pdf"' : "" }, arrayBuffer:async () => Buffer.from("pdf") };
  } });
  assert.match(captured.url, /expenses\/expense%201\/invoice/);
  assert.equal(captured.options.headers.Authorization, "Bearer secret");
  assert.equal(invoice.fileName, "invoice.pdf");
  assert.equal(Buffer.from(invoice.dataBase64, "base64").toString(), "pdf");
});
