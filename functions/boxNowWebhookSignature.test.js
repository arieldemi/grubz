const test = require("node:test");
const assert = require("node:assert/strict");
const { hmacHex, verifyBoxNowWebhookPayload } = require("./boxNowWebhookSignature");

const secret = "stage-webhook-secret";
const rawData = '{"parcelReferenceNumber":"BOXNOW-TEST-1785772721320-1","customer":{"name":"GRUBZ BOX NOW Test","email":"arieldemi@gmail.com","phoneNumber":"+306940294873"},"parcelState":"new","event":"new","time":"2026-08-03T15:58:42.711Z","parcelId":"9836157375","orderNumber":"BOXNOW-TEST-1785772721320","parcelName":"BOXNOW-TEST-1785772721320 parcel 1"}';

function requestBody(dataText = rawData, signature = hmacHex(dataText, secret)) {
  return `{"specversion":"1.0","subject":"9836157375","data":${dataText},"datasignature":"${signature}"}`;
}

test("verifies BOX NOW HMAC against the exact raw data object", () => {
  const rawBody = requestBody();
  const payload = JSON.parse(rawBody);
  assert.equal(verifyBoxNowWebhookPayload(Buffer.from(rawBody), payload, secret).verified, true);
});

test("does not accept a signature calculated over normalized JSON", () => {
  const spacedData = `{ "event": "new", "parcelId": "9836157375" }`;
  const normalizedSignature = hmacHex(JSON.stringify(JSON.parse(spacedData)), secret);
  const rawBody = requestBody(spacedData, normalizedSignature);
  const result = verifyBoxNowWebhookPayload(Buffer.from(rawBody), JSON.parse(rawBody), secret);
  assert.deepEqual(result, { verified: false, reason: "signature_mismatch" });
});

test("reports missing secrets and malformed signatures distinctly", () => {
  const rawBody = requestBody();
  const payload = JSON.parse(rawBody);
  assert.equal(verifyBoxNowWebhookPayload(rawBody, payload, "").reason, "missing_webhook_secret");
  payload.datasignature = "not-a-sha256-hex-digest";
  assert.equal(verifyBoxNowWebhookPayload(rawBody, payload, secret).reason, "invalid_datasignature_format");
});
