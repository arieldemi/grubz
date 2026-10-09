const test = require("node:test");
const assert = require("node:assert/strict");
const { randomBytes } = require("crypto");
const { encryptNomaCredential, decryptNomaCredential } = require("./nomaCredentialVault");

test("encrypts and decrypts NOMA credentials without storing plaintext", () => {
  const masterKey = randomBytes(32).toString("base64");
  const raw = "noma_live_example-secret";
  const encrypted = encryptNomaCredential(raw, masterKey);
  assert.equal(decryptNomaCredential(encrypted, masterKey), raw);
  assert.equal(JSON.stringify(encrypted).includes(raw), false);
});

test("rejects missing master keys and tampered ciphertext", () => {
  const masterKey = randomBytes(32).toString("base64");
  assert.throws(() => encryptNomaCredential("key", ""), /not configured/);
  const encrypted = encryptNomaCredential("key", masterKey);
  encrypted.ciphertext = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptNomaCredential(encrypted, masterKey), /could not be decrypted/);
});
