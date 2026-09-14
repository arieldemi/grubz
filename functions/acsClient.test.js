const test = require("node:test");
const assert = require("node:assert/strict");
const { acsBusinessError, acsTableRows, acsValueRows, createAcsClient, extractPdf } = require("./acsClient");

const credentials = { companyId: "company", companyPassword: "company-pass", userId: "user", userPassword: "user-pass", billingCode: "billing", apiKey: "api-key" };

test("ACS client sends API key, alias, and credentials", async () => {
  let request;
  const client = createAcsClient(credentials, { fetchImpl: async (url, options) => {
    request = { url, options, body: JSON.parse(options.body) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ ACSExecution_HasError: false, ACSOutputResponce: { ACSValueOutput: [] } }) };
  } });
  await client.getPickupLists({ Language: "EN", Pickup_Date: "2026-09-11" });
  assert.equal(request.options.headers.AcsApiKey, "api-key");
  assert.equal(request.body.ACSAlias, "ACS_Get_Pickup_Lists");
  assert.equal(request.body.ACSInputParameters.Company_ID, "company");
  assert.equal(request.body.ACSInputParameters.Pickup_Date, "2026-09-11");
});

test("ACS HTTP 200 business errors reject", async () => {
  const client = createAcsClient(credentials, { fetchImpl: async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ ACSExecution_HasError: true, ACSExecutionErrorMessage: "Invalid credentials" }) }) });
  await assert.rejects(() => client.getPickupLists({}), /Invalid credentials/);
});

test("ACS response helpers support documented misspelling", () => {
  const response = { ACSOutputResponce: { ACSValueOutput: [{ Voucher_No: "123" }], ACSTableOutput: { Table_Data: [{ PickupList_No: "456" }] } } };
  assert.equal(acsValueRows(response)[0].Voucher_No, "123");
  assert.equal(acsTableRows(response)[0].PickupList_No, "456");
  assert.equal(acsBusinessError(response), "");
});

test("extractPdf finds ACS byte-array PDFs", () => {
  const bytes = [...Buffer.from("%PDF-1.7\nexample")];
  const pdf = extractPdf({ ACSOutputResponce: { ACSValueOutput: [{ ACSObjectOutput: { voucher: bytes } }] } });
  assert.equal(Buffer.from(pdf.base64, "base64").subarray(0, 5).toString(), "%PDF-");
});
