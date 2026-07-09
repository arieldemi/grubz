#!/usr/bin/env node

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const email = String(process.argv[2] || "").trim();
const value = process.argv[3] == null ? true : !["false", "0", "no"].includes(String(process.argv[3]).toLowerCase());

if (!email) {
  console.error("Usage: node functions/scripts/setAdminClaim.js <email> [true|false]");
  process.exit(1);
}

initializeApp({
  credential: applicationDefault(),
  projectId: "grubz-99b84",
});

(async () => {
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  const existing = user.customClaims || {};
  const customClaims = { ...existing, admin: value };
  await auth.setCustomUserClaims(user.uid, customClaims);
  console.log(`Set admin=${value} for ${email} (${user.uid})`);
  console.log("Sign out and sign back in, or refresh the ID token, for the claim to appear in the browser.");
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
