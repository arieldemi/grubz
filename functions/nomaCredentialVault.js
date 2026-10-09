const { createCipheriv, createDecipheriv, randomBytes } = require("crypto");

function encryptionKey(value) {
  let key;
  try { key = Buffer.from(String(value || ""), "base64"); } catch { key = Buffer.alloc(0); }
  if (key.length !== 32) throw Object.assign(new Error("NOMA credential encryption is not configured"), { status:503, code:"not_configured" });
  return key;
}

function encryptNomaCredential(rawCredential, masterKey) {
  const value = String(rawCredential || "").trim();
  if (!value) throw Object.assign(new Error("NOMA API key is required"), { status:400 });
  if (value.length > 1000) throw Object.assign(new Error("NOMA API key is too long"), { status:400 });
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(masterKey), iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { version:1, algorithm:"aes-256-gcm", iv:iv.toString("base64"), tag:cipher.getAuthTag().toString("base64"), ciphertext:ciphertext.toString("base64") };
}

function decryptNomaCredential(payload, masterKey) {
  if (!payload || payload.version !== 1 || payload.algorithm !== "aes-256-gcm") throw Object.assign(new Error("Stored NOMA credential is invalid"), { status:503 });
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(masterKey), Buffer.from(payload.iv, "base64"));
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(payload.ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch (error) {
    if (error.status) throw error;
    throw Object.assign(new Error("Stored NOMA credential could not be decrypted"), { status:503 });
  }
}

module.exports = { encryptNomaCredential, decryptNomaCredential };
