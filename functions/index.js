// functions/index.js

const { onRequest } = require("firebase-functions/v2/https");
const { beforeUserCreated } = require("firebase-functions/v2/identity");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const Stripe = require("stripe");
const cors = require("cors");

// ----- Secrets -----
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const BOXNOW_CLIENT_ID = defineSecret("BOXNOW_CLIENT_ID");
const BOXNOW_CLIENT_SECRET = defineSecret("BOXNOW_CLIENT_SECRET");
const BOXNOW_PARTNER_ID = defineSecret("BOXNOW_PARTNER_ID");
const BOXNOW_API_BASE_URL = "https://api-production.boxnow.gr";
const BOXNOW_CONFIGURED_FEE_ENDPOINT = "";
const BOXNOW_FALLBACK_FEE_CENTS = 0;

// ----- CORS -----
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5100",
  "http://127.0.0.1:5100",
  "http://localhost:5101",
  "http://127.0.0.1:5101",
  "https://grubz-99b84.web.app",
  "https://grubz-99b84.firebaseapp.com",
  "https://grubz.gr",
  "https://www.grubz.gr",
]);

initializeApp();
const db = getFirestore(undefined, "grubz"); // named DB

const PRODUCTS_MAP = {
  "grubz-100g": {
    productId: "prod_T04mib5buNalmY",
    priceId: "price_1SOKizCIlWvuSYE0f718KzIH",
    amount: 690, // cents
    weightGrams: 100,
    currency: "eur",
    name: "GRUBZ SNACK (100g)",
  },
  "grubz-300g": {
    productId: "prod_T04nyqco6u5tng",
    priceId: "price_1SOKjZCIlWvuSYE0JCTrqTIg",
    amount: 1790,
    weightGrams: 300,
    currency: "eur",
    name: "GRUBZ PREMIUM (300g)",
  },
  "grubz-500g": {
    productId: "prod_T04orna0NLSofu",
    priceId: "price_1SOKlECIlWvuSYE0VgEtLPoj",
    amount: 3690,
    weightGrams: 500,
    currency: "eur",
    name: "GRUBZ JUMBO (500g)",
  },
  "happy-chicken-1kg": {
    productId: "prod_UqXuwHrzsk73em",
    priceId: "price_1TqqolCIlWvuSYE0BC5cgRo0",
    amount: 590,
    weightGrams: 1000,
    currency: "eur",
    name: "Happy Chicken - 1kg",
  },
  "happy-chicken-2kg": {
    productId: "prod_UqXuUWqKQIrcmR",
    priceId: "price_1TqqonCIlWvuSYE0jtDBgH4z",
    amount: 1190,
    weightGrams: 2000,
    currency: "eur",
    name: "Happy Chicken - 2kg",
  },
  "happy-chicken-3kg": {
    productId: "prod_UqXuZ1Qqas8NgB",
    priceId: "price_1TqqooCIlWvuSYE0nnRgPzQo",
    amount: 1590,
    weightGrams: 3000,
    currency: "eur",
    name: "Happy Chicken - 3kg",
  },
};

function stripeClient(secret) {
  return new Stripe(secret, { apiVersion: "2024-09-30.acacia" });
}

const corsMw = cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.has(origin)) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
  credentials: true,
});

// Where to return users after checkout:
const HOSTING_BASE = "https://www.grubz.gr";

function allowOrigin(origin) {
  return (
    !origin ||
    /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) ||
    origin === "https://grubz.gr" ||
    origin === "https://www.grubz.gr"
  );
}

exports.verifyCheckout = onRequest(
  { region: "europe-west1", secrets: [STRIPE_SECRET_KEY] },
  async (req, res) => {
    // CORS (simple & preflight)
    const origin = req.headers.origin || "";
    if (allowOrigin(origin)) {
      res.set("Access-Control-Allow-Origin", origin || "*");
      res.set("Vary", "Origin");
      res.set("Access-Control-Allow-Headers", "authorization, content-type");
      res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    }
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "GET") return res.status(405).send("Use GET");

    try {
      const uid = await uidFromAuthHeader(req);
      if (!uid) return res.status(401).json({ error: "Unauthorized" });

      const sid = String(req.query.sid || "").trim();
      if (!sid) return res.status(400).json({ error: "Missing sid" });

      const secret = STRIPE_SECRET_KEY.value();
      const stripe = stripeClient(secret);
      const session = await stripe.checkout.sessions.retrieve(sid);

      if (session?.metadata?.uid && session.metadata.uid !== "guest" && session.metadata.uid !== uid) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const paid =
        session?.status === "complete" && session?.payment_status === "paid";

      return res.json({
        paid,
        amount_total: session?.amount_total || null,
        currency: session?.currency || null,
      });
    } catch (e) {
      console.error("verifyCheckout error:", e);
      return res.status(400).json({ error: e.message || "Verify failed" });
    }
  }
);

exports.userBootstrap = beforeUserCreated(
  { region: "europe-west1" },
  async (event) => {
    const { uid, email } = event.data || {};
    try {
      await db.doc(`users/${uid}`).set(
        { email: email || null, createdAt: Timestamp.now(), shipping: null },
        { merge: true }
      );
    } catch (err) {
      console.error("userBootstrap failed", err);
    }
    return;
  }
);

async function uidFromBearer(req) {
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    return (await getAdminAuth().verifyIdToken(m[1])).uid;
  } catch {
    return null;
  }
}

function jsonError(res, code, message, extra = {}) {
  return res.status(code).json({ error: message, ...extra });
}

function secretValue(secret, fallback = "") {
  try {
    return secret.value() || fallback;
  } catch {
    return fallback;
  }
}

function normalizeBoxNowBase() {
  return BOXNOW_API_BASE_URL.replace(/\/+$/, "");
}

function normalizeCartItems(items) {
  return (Array.isArray(items) ? items : []).map(({ id, qty }) => {
    const p = PRODUCTS_MAP[id];
    if (!p) throw new Error(`Unknown product id: ${id}`);
    return { id, qty: Math.max(1, Number(qty || 0)), product: p };
  });
}

function cartWeightGrams(items) {
  return normalizeCartItems(items).reduce((sum, item) => {
    return sum + (Number(item.product.weightGrams || 0) * item.qty);
  }, 0);
}

function parseFeeCents(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value * 100));
  if (typeof value === "string") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const parsed = parseFeeCents(item);
      if (parsed != null) return parsed;
    }
    return null;
  }
  if (typeof value === "object") {
    const directKeys = [
      "fee",
      "price",
      "amount",
      "cost",
      "total",
      "deliveryFee",
      "shippingFee",
      "grossAmount",
      "totalAmount",
    ];
    for (const key of directKeys) {
      const parsed = parseFeeCents(value[key]);
      if (parsed != null) return parsed;
    }
    for (const key of ["data", "result", "rate", "rates", "pricing", "prices"]) {
      const parsed = parseFeeCents(value[key]);
      if (parsed != null) return parsed;
    }
  }
  return null;
}

async function boxNowRequest(path, options = {}) {
  const base = normalizeBoxNowBase();
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const resp = await fetch(url, options);
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { ok: resp.ok, status: resp.status, data };
}

async function getBoxNowToken() {
  const clientId = secretValue(BOXNOW_CLIENT_ID);
  const clientSecret = secretValue(BOXNOW_CLIENT_SECRET);
  if (!clientId || !clientSecret) return null;

  const bodies = [
    { client_id: clientId, client_secret: clientSecret },
    { clientId, clientSecret },
    { grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret },
  ];
  const paths = ["/api/v1/auth-sessions", "/api/v1/oauth/token", "/oauth/token"];

  for (const path of paths) {
    for (const body of bodies) {
      const r = await boxNowRequest(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) continue;
      const token =
        r.data?.access_token ||
        r.data?.accessToken ||
        r.data?.token ||
        r.data?.jwt ||
        r.data?.data?.access_token ||
        r.data?.data?.accessToken ||
        r.data?.data?.token;
      if (token) return token;
    }
  }

  return null;
}

async function calculateBoxNowFee(items, shipping) {
  const normalized = normalizeCartItems(items);
  const weightGrams = cartWeightGrams(items);
  const boxNow = shipping?.boxNow || {};
  const partnerId = secretValue(BOXNOW_PARTNER_ID);
  const postalCode = String(boxNow.postalCode || shipping?.postal || "").replace(/\s+/g, "");
  const payload = {
    partnerId,
    destinationLockerId: String(boxNow.id || ""),
    destinationPostalCode: postalCode,
    postalCode,
    country: shipping?.country || "GR",
    currency: "EUR",
    weightGrams,
    parcelSize: "3",
    parcels: [{ weight: weightGrams / 1000, weightGrams, size: "3" }],
    items: normalized.map(({ id, qty, product }) => ({
      id,
      quantity: qty,
      name: product.name,
      weightGrams: product.weightGrams || 0,
      amount: product.amount,
      currency: product.currency || "eur",
    })),
  };

  const configuredEndpoint = BOXNOW_CONFIGURED_FEE_ENDPOINT;
  const endpointCandidates = configuredEndpoint
    ? [configuredEndpoint]
    : [
        "/api/v1/pricing",
        "/api/v1/rates",
        "/api/v1/price",
        "/api/v1/delivery-requests/price",
        "/api/v1/delivery-requests:calculate-price",
      ];

  const token = await getBoxNowToken();
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (partnerId) headers["x-partner-id"] = partnerId;

  for (const endpoint of endpointCandidates) {
    const r = await boxNowRequest(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!r.ok) continue;
    const amountCents = parseFeeCents(r.data);
    if (amountCents != null) {
      return {
        amount: amountCents,
        currency: "eur",
        source: configuredEndpoint ? "boxnow" : "boxnow-discovered",
        weightGrams,
      };
    }
  }

  const fallback = Number(BOXNOW_FALLBACK_FEE_CENTS);
  return {
    amount: Number.isFinite(fallback) ? Math.max(0, Math.round(fallback)) : 0,
    currency: "eur",
    source: "fallback",
    weightGrams,
  };
}

exports.getBoxNowFee = onRequest(
  {
    region: "europe-west1",
    secrets: [
      BOXNOW_CLIENT_ID,
      BOXNOW_CLIENT_SECRET,
      BOXNOW_PARTNER_ID,
    ],
    cors: [
      "https://grubz.gr",
      "https://www.grubz.gr",
      "http://localhost:5100",
      "http://127.0.0.1:5100",
      "http://localhost:5101",
      "http://127.0.0.1:5101",
      "http://localhost:5101",
      "http://127.0.0.1:5101",
    ],
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method !== "POST") return jsonError(res, 405, "Use POST");

      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const items = Array.isArray(body.items) ? body.items : [];
      const shipping = body.shipping && typeof body.shipping === "object" ? body.shipping : null;

      if (!items.length) return jsonError(res, 400, "No items");
      if (!shipping?.boxNow?.id) return jsonError(res, 400, "Missing BOX NOW locker");

      const fee = await calculateBoxNowFee(items, shipping);
      return res.json({ ok: true, ...fee });
    } catch (e) {
      logger.error("getBoxNowFee failed", e);
      return jsonError(res, 400, e.message || "BOX NOW fee unavailable");
    }
  }
);

// ===== Create Checkout Session =====
exports.createCheckoutSession = onRequest(
  {
    region: "europe-west1",
    secrets: [
      STRIPE_SECRET_KEY,
      BOXNOW_CLIENT_ID,
      BOXNOW_CLIENT_SECRET,
      BOXNOW_PARTNER_ID,
    ],
    cors: [
      "https://grubz.gr",
      "https://www.grubz.gr",
      "http://localhost:5100",
      "http://127.0.0.1:5100",
      "http://localhost:5101",
      "http://127.0.0.1:5101",
      "http://localhost:5101",
      "http://127.0.0.1:5101",
    ],
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

      const uid = await uidFromBearer(req); // may be null (guest allowed)

      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const items = Array.isArray(body.items) ? body.items : [];
      const promotionCodeId = body.promotionCodeId ? String(body.promotionCodeId).trim() : null;
      const shipping = body.shipping && typeof body.shipping === "object" ? body.shipping : null;
      const boxNow = shipping && shipping.boxNow && typeof shipping.boxNow === "object" ? shipping.boxNow : null;

      if (!items.length) return res.status(400).json({ error: "No items" });
      if (!String(boxNow?.id || "").trim()) {
        return res.status(400).json({ error: "Missing BOX NOW locker" });
      }

      const line_items = items.map(({ id, qty }) => {
        const p = PRODUCTS_MAP[id];
        if (!p) throw new Error(`Unknown product id: ${id}`);
        const quantity = Math.max(1, Number(qty || 0));
        if (p.priceId) return { price: p.priceId, quantity };
        return {
          quantity,
          price_data: {
            currency: p.currency || "eur",
            unit_amount: Number(p.amount),
            product_data: { name: p.name || id },
          },
        };
      });

      const boxNowFee = await calculateBoxNowFee(items, shipping);
      if (boxNowFee.amount > 0) {
        line_items.push({
          quantity: 1,
          price_data: {
            currency: boxNowFee.currency || "eur",
            unit_amount: boxNowFee.amount,
            product_data: { name: "BOX NOW delivery" },
          },
        });
      }

      const secret = STRIPE_SECRET_KEY.value();
      const stripe = stripeClient(secret);

      const params = {
        mode: "payment",
        line_items,
        automatic_tax: { enabled: false },
        success_url: `${HOSTING_BASE}/checkout/success?sid={CHECKOUT_SESSION_ID}`,
        cancel_url: `${HOSTING_BASE}/checkout/cancelled`,
        metadata: {
          uid: uid || "guest",
          cart: JSON.stringify(items).slice(0, 5000),
          deliveryMethod: shipping?.deliveryMethod || "boxnow",
          shippingName: String(shipping?.name || "").slice(0, 500),
          shippingPhone: String(shipping?.phone || "").slice(0, 500),
          boxnowLockerId: String(boxNow?.id || "").slice(0, 500),
          boxnowLockerName: String(boxNow?.name || "").slice(0, 500),
          boxnowLockerPostalCode: String(boxNow?.postalCode || "").slice(0, 500),
          boxnowLockerAddressLine1: String(boxNow?.addressLine1 || "").slice(0, 500),
          boxnowLockerAddressLine2: String(boxNow?.addressLine2 || "").slice(0, 500),
          boxnowFeeAmount: String(boxNowFee.amount || 0).slice(0, 500),
          boxnowFeeCurrency: String(boxNowFee.currency || "eur").slice(0, 500),
          boxnowFeeSource: String(boxNowFee.source || "").slice(0, 500),
          boxnowWeightGrams: String(boxNowFee.weightGrams || 0).slice(0, 500),
        },
      };

      if (promotionCodeId) {
        params.discounts = [{ promotion_code: promotionCodeId }];
      } else {
        params.allow_promotion_codes = true;
      }

      const session = await stripe.checkout.sessions.create(params);
      return res.status(200).json({ url: session.url });
    } catch (err) {
      console.error("createCheckoutSession error:", err);
      return res.status(400).json({ error: err.message || "Stripe error" });
    }
  }
);

// ===== Stripe Webhook =====
exports.stripeWebhook = onRequest(
  { region: "europe-west1", secrets: [STRIPE_WEBHOOK_SECRET, STRIPE_SECRET_KEY] },
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    const whSecret = STRIPE_WEBHOOK_SECRET.value();
    if (!sig || !whSecret) return res.status(400).send("Missing webhook secret or signature");

    let event;
    try {
      const secret = STRIPE_SECRET_KEY.value();
      const stripe = stripeClient(secret);
      event = stripe.webhooks.constructEvent(req.rawBody, sig, whSecret);
    } catch (e) {
      return res.status(400).send(`Webhook signature verification failed: ${e.message}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          // TODO: fulfill order
          break;
        }
        default:
          break;
      }
      return res.status(200).send("[ok]");
    } catch (err) {
      logger.error("Webhook handler error", err);
      return res.status(500).send("Webhook handler error");
    }
  }
);

// ===== Public stock (from Stripe product metadata.stock) =====
exports.getStock = onRequest(
  {
    region: "europe-west1",
    cors: [
      "https://grubz.gr",
      "https://www.grubz.gr",
      "http://localhost:5100",
      "http://127.0.0.1:5100",
    ],
    secrets: [STRIPE_SECRET_KEY],
  },
  async (req, res) => {
    try {
      const secret = STRIPE_SECRET_KEY.value();
      const stripe = stripeClient(secret);
      const result = {};

      for (const [clientId, { productId }] of Object.entries(PRODUCTS_MAP)) {
        if (!productId) continue;
        const p = await stripe.products.retrieve(productId);
        const raw = p.metadata?.stock || "0";
        result[clientId] = Math.max(0, parseInt(raw, 10) || 0);
      }

      res.status(200).json(result);
    } catch (e) {
      logger.error("getStock failed", e);
      res.status(500).json({ error: "stock_unavailable" });
    }
  }
);

// ===== Validate coupon (returns promotionCodeId now) =====
exports.validateCoupon = onRequest(
  {
    region: "europe-west1",
    secrets: [STRIPE_SECRET_KEY],
    cors: [
      "https://grubz.gr",
      "https://www.grubz.gr",
      "http://localhost:5100",
      "http://127.0.0.1:5100",
    ],
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method !== "POST") return jsonError(res, 405, "Use POST");

      const { code, items } =
        typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});

      const couponCode = String(code || "").trim();
      if (!couponCode) return jsonError(res, 400, "Missing coupon code");

      const cartItems = Array.isArray(items) ? items : [];
      if (!cartItems.length) return jsonError(res, 400, "No items");

      // Compute EUR subtotal from PRODUCTS_MAP
      let subtotalEUR = 0;
      for (const { id, qty } of cartItems) {
        const p = PRODUCTS_MAP[id];
        if (!p) return jsonError(res, 400, `Unknown product: ${id}`);
        const q = Math.max(1, Number(qty || 0));
        subtotalEUR += (p.amount * q) / 100; // cents->EUR
      }

      const secret = STRIPE_SECRET_KEY.value();
      const stripe = stripeClient(secret);
      const promos = await stripe.promotionCodes.list({
        code: couponCode,
        active: true,
        limit: 1,
      });

      if (!promos.data || !promos.data.length) {
        return jsonError(res, 404, "Invalid coupon");
      }

      const promo = promos.data[0]; // promotion_code object
      const coupon = promo.coupon;

      // Estimate discount (EUR only) for preview
      let discountEUR = 0;
      if (coupon.percent_off) {
        discountEUR = (subtotalEUR * coupon.percent_off) / 100;
        if (coupon.amount_off) {
          discountEUR += coupon.amount_off / 100.0;
        }
      } else if (coupon.amount_off) {
        if (coupon.currency && coupon.currency.toLowerCase() !== "eur") {
          return jsonError(res, 400, "Coupon currency not supported");
        }
        discountEUR = coupon.amount_off / 100.0;
      }
      discountEUR = Math.max(0, Math.min(discountEUR, subtotalEUR));

      return res.json({
        ok: true,
        code: promo.code,
        promotionCodeId: promo.id, // <-- CRITICAL so checkout can auto-apply
        discount: Number(discountEUR.toFixed(2)),
      });
    } catch (e) {
      logger.error("validateCoupon failed", e);
      return jsonError(res, 400, e.message || "Coupon validation failed");
    }
  }
);

// --- Helpers
async function uidFromAuthHeader(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    const decoded = await getAdminAuth().verifyIdToken(m[1]);
    return decoded.uid || null;
  } catch (e) {
    logger.warn("verifyIdToken failed", e);
    return null;
  }
}

function validateShipping(s) {
  if (!s || typeof s !== "object") return "Missing shipping";
  const reqd = ["name", "phone", "postal", "country"];
  const missing = reqd.filter((k) => !String(s[k] || "").trim());
  return missing.length ? `Missing: ${missing.join(", ")}` : null;
}

// --- GET /getProfile
exports.getProfile = onRequest({ region: "europe-west1" }, (req, res) =>
  corsMw(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).end();
    const uid = await uidFromAuthHeader(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const snap = await db.doc(`users/${uid}`).get();
    const data = snap.exists ? snap.data() : {};
    return res.json({
      email: data.email || null,
      shipping: data.shipping || null,
    });
  })
);

// --- POST /saveShipping
exports.saveShipping = onRequest({ region: "europe-west1" }, (req, res) =>
  corsMw(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).end();
    if (req.method !== "POST") return res.status(405).send("Use POST");

    const uid = await uidFromAuthHeader(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    const shipping = (req.body && req.body.shipping) || null;
    const err = validateShipping(shipping);
    if (err) return res.status(400).json({ error: err });

    await db.doc(`users/${uid}`).set({ shipping }, { merge: true });
    return res.json({ ok: true });
  })
);
