const { createHmac, timingSafeEqual } = require("crypto");

function extractRawJsonProperty(raw, propertyName) {
  const text = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || "");
  const key = `"${propertyName}"`;
  const keyIndex = text.indexOf(key);
  if (keyIndex < 0) return "";
  const colonIndex = text.indexOf(":", keyIndex + key.length);
  if (colonIndex < 0) return "";
  let index = colonIndex + 1;
  while (/\s/.test(text[index] || "")) index += 1;
  const opener = text[index];
  const closer = opener === "{" ? "}" : opener === "[" ? "]" : "";
  if (!closer) return "";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = index; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === opener) depth += 1;
    else if (ch === closer) {
      depth -= 1;
      if (depth === 0) return text.slice(index, i + 1);
    }
  }
  return "";
}

function hmacHex(value, secret) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function safeHexEqual(leftHex, rightHex) {
  const left = String(leftHex || "").trim().toLowerCase();
  const right = String(rightHex || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(left) || !/^[0-9a-f]{64}$/.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function verifyBoxNowWebhookPayload(rawBody, payload, webhookSecret) {
  const signature = String(payload?.datasignature || payload?.dataSignature || "").trim();
  if (!signature) return { verified: false, skipped: true, reason: "missing_datasignature" };
  if (!/^[0-9a-f]{64}$/i.test(signature)) return { verified: false, reason: "invalid_datasignature_format" };
  if (!webhookSecret) return { verified: false, skipped: true, reason: "missing_webhook_secret" };

  const rawData = extractRawJsonProperty(rawBody, "data");
  if (!rawData) return { verified: false, reason: "missing_raw_data" };
  const digest = hmacHex(rawData, webhookSecret);
  return safeHexEqual(digest, signature)
    ? { verified: true, digest, signedContent: "raw_data" }
    : { verified: false, reason: "signature_mismatch" };
}

module.exports = {
  extractRawJsonProperty,
  hmacHex,
  verifyBoxNowWebhookPayload,
};
