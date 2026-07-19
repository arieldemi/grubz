// functions/index.js

const { onRequest } = require("firebase-functions/v2/https");
const { beforeUserCreated, HttpsError } = require("firebase-functions/v2/identity");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const { getStorage } = require("firebase-admin/storage");
const { randomUUID, createHash, createHmac, timingSafeEqual } = require("crypto");
const Stripe = require("stripe");
const cors = require("cors");
const nodemailer = require("nodemailer");

// ----- Secrets -----
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const STRIPE_SECRET_KEY_TEST = defineSecret("STRIPE_SECRET_KEY_TEST");
const STRIPE_WEBHOOK_SECRET_TEST = defineSecret("STRIPE_WEBHOOK_SECRET_TEST");
const STRIPE_SECRET_KEY_LIVE = defineSecret("STRIPE_SECRET_KEY_LIVE");
const STRIPE_WEBHOOK_SECRET_LIVE = defineSecret("STRIPE_WEBHOOK_SECRET_LIVE");
const STRIPE_SECRETS = [
  STRIPE_SECRET_KEY,
  STRIPE_SECRET_KEY_TEST,
  STRIPE_SECRET_KEY_LIVE,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_WEBHOOK_SECRET_TEST,
  STRIPE_WEBHOOK_SECRET_LIVE,
];
const BOXNOW_CLIENT_ID = defineSecret("BOXNOW_CLIENT_ID");
const BOXNOW_CLIENT_SECRET = defineSecret("BOXNOW_CLIENT_SECRET");
const BOXNOW_PARTNER_ID = defineSecret("BOXNOW_PARTNER_ID");
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const ORDER_NOTIFICATION_EMAIL = defineSecret("ORDER_NOTIFICATION_EMAIL");
const ORDER_NOTIFICATION_FROM = defineSecret("ORDER_NOTIFICATION_FROM");
const SOCIAL_AGENT_WEBHOOK_SECRET = defineSecret("SOCIAL_AGENT_WEBHOOK_SECRET");
const BOXNOW_API_BASE_URL = "https://api-production.boxnow.gr";
const BOXNOW_ENVIRONMENTS = {
  stage: {
    label: "Stage",
    apiBaseUrl: "https://api-stage.boxnow.gr",
    locationBaseUrl: "https://locationapi-stage.boxnow.gr/api/v1",
  },
  production: {
    label: "Production",
    apiBaseUrl: "https://api-production.boxnow.gr",
    locationBaseUrl: "https://locationapi-production.boxnow.gr/api/v1",
  },
};
const BOXNOW_CONFIGURED_FEE_ENDPOINT = "";
const BOXNOW_FALLBACK_FEE_CENTS = 0;
const BOXNOW_PARCEL_SIZES = [
  { code: "1", label: "Small", amount: 300, heightCm: 8, widthCm: 45, lengthCm: 60 },
  { code: "2", label: "Medium", amount: 500, heightCm: 17, widthCm: 45, lengthCm: 60 },
  { code: "3", label: "Large", amount: 1000, heightCm: 36, widthCm: 45, lengthCm: 60 },
];
const SHIPPING_SETTINGS_DOC = "settings/shipping";
const STRIPE_SETTINGS_DOC = "settings/stripe";
const ORDER_EMAIL_SETTINGS_DOC = "settings/orderEmails";
const BOXNOW_SETTINGS_DOC = "settings/boxnow";
const SOCIAL_AGENT_SETTINGS_DOC = "settings/socialAgent";
const COUPONS_COLLECTION = "coupons";
const EMAIL_RESERVATIONS_COLLECTION = "emailReservations";
const SOCIAL_OPPORTUNITIES_COLLECTION = "socialOpportunities";
const CHAT_CONVERSATIONS_COLLECTION = "chatConversations";
const GRUBZ_SIGNATURE_IMAGE_URL = "https://grubz.gr/images/grubz-email-signature.png";
const GRUBZ_INFO_EMAIL = "info@grubz.gr";
const GRUBZ_EMAIL_SIGNATURE_HTML = `
<div>
  <table cellpadding="0" width="600" style="border-collapse:collapse;font-size:11.8px;">
    <tr>
      <td style="margin:0.1px;padding:0;">
        <table cellpadding="0" style="border-collapse:collapse;">
          <tr>
            <td style="margin:0.1px;padding:0 15px 0 0;" valign="middle">
              <table cellpadding="0" style="border-collapse:collapse;">
                <tr>
                  <td style="font:15.2px/18.1px Arial, Helvetica, sans-serif; color:#6a3d23; font-weight: bold;">
                    <span>GRUBZ Team</span>
                  </td>
                </tr>
              </table>
            </td>
            <td valign="top" style="background-color: #000; margin:0.1px;padding:0 1px 0 0;"></td>
            <td valign="middle" style="margin:0.1px;padding:0 15px 0 0;">
              <a href="https://grubz.gr" target="_blank">
                <img src="${GRUBZ_SIGNATURE_IMAGE_URL}" width="170" style="display:block;min-width:100px;" alt="GRUBZ">
              </a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
  <div>
    <table style="width:500px;color:#000001;line-height:1;font-size:14.1px;border-collapse:collapse;" cellpadding="0" width="500">
      <tr>
        <td style="padding:10px 0 0 0;margin:0.1px;min-width:24px;" width="24" height="24" align="center"></td>
        <td style="font-family:Arial, Helvetica, sans-serif;font-size:14.1px;padding:10px 0 0 0;margin:0.1px;"></td>
      </tr>
    </table>
    <table width="500" cellspacing="0" cellpadding="0" border="0">
      <tr>
        <td style="margin:0.1px;line-height:1px;font-size:1px;height:1px;">&nbsp;</td>
      </tr>
    </table>
  </div>
  <table cellpadding="0" style="border-collapse:collapse;">
    <tr>
      <td style="margin:0.1px;display:block;padding:15px 0 0 0;"></td>
    </tr>
    <tr>
      <td style="margin:0.1px;border-top:1px solid #eeeeee;padding-top:5px;font-size:10px;font-family:Arial;"></td>
    </tr>
  </table>
</div>`;
const GRUBZ_EMAIL_SIGNATURE_TEXT = "GRUBZ Team\nhttps://grubz.gr";
const ORDER_FULFILLMENT_EMAIL_TEMPLATES = [
  {
    enabled: true,
    fulfillmentStatus: "new",
    subject: "We received your GRUBZ order {orderNumber}",
    body: "Hi {customerName},\n\nWe received your GRUBZ order {orderNumber} and it is now in our queue.\n\nTotal: {total}\n\nGRUBZ",
  },
  {
    enabled: true,
    fulfillmentStatus: "processing",
    subject: "Your GRUBZ order {orderNumber} is being prepared",
    body: "Hi {customerName},\n\nYour GRUBZ order {orderNumber} is now being prepared.\n\nWe will update you again when it is packed.\n\nGRUBZ",
  },
  {
    enabled: true,
    fulfillmentStatus: "packed",
    subject: "Your GRUBZ order {orderNumber} is packed",
    body: "Hi {customerName},\n\nYour GRUBZ order {orderNumber} has been packed and is almost ready to ship.\n\nGRUBZ",
  },
  {
    enabled: true,
    fulfillmentStatus: "shipped",
    subject: "Your GRUBZ order {orderNumber} has shipped",
    body: "Hi {customerName},\n\nYour GRUBZ order {orderNumber} has shipped.\n\nTracking number: {trackingNumber}\nTracking link: {trackingUrl}\n\nGRUBZ",
  },
  {
    enabled: true,
    fulfillmentStatus: "delivered",
    subject: "Your GRUBZ order {orderNumber} was delivered",
    body: "Hi {customerName},\n\nYour GRUBZ order {orderNumber} has been delivered.\n\nThank you for choosing GRUBZ.\n\nGRUBZ",
  },
  {
    enabled: true,
    fulfillmentStatus: "cancelled",
    subject: "Your GRUBZ order {orderNumber} was cancelled",
    body: "Hi {customerName},\n\nYour GRUBZ order {orderNumber} has been cancelled.\n\nIf you have any questions, reply to this email.\n\nGRUBZ",
  },
];
const DEFAULT_NOTIFICATION_EMAIL = "info@grubz.gr";
const DEFAULT_NOTIFICATION_FROM = "GRUBZ Orders <orders@grubz.gr>";
let smtpTransporter = null;

// ----- CORS -----
const ALLOWED_ORIGINS = new Set([
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "http://localhost:5100",
  "http://127.0.0.1:5100",
  "http://localhost:5101",
  "http://127.0.0.1:5101",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
  "https://grubz-99b84.web.app",
  "https://grubz-99b84.firebaseapp.com",
  "https://grubz.gr",
  "https://www.grubz.gr",
]);
const ALLOWED_ORIGIN_LIST = Array.from(ALLOWED_ORIGINS);

initializeApp();
const db = getFirestore(undefined, "grubz");

let PRODUCTS_MAP = {};

function stripeClient(secret) {
  return new Stripe(secret, { apiVersion: "2024-09-30.acacia" });
}

function now() {
  return Timestamp.now();
}

function normalizedEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function emailReservationDocId(emailKey = "") {
  return createHash("sha256").update(emailKey).digest("hex");
}

function productDocToRuntime(id, data = {}) {
  const stripe = data.stripe && typeof data.stripe === "object" ? data.stripe : {};
  const testStripe = stripe.test && typeof stripe.test === "object" ? stripe.test : {};
  const liveStripe = stripe.live && typeof stripe.live === "object" ? stripe.live : {};
  const legacyProductId = data.stripeProductId || data.productId || "";
  const legacyPriceId = data.stripePriceId || data.priceId || "";
  const parcel = data.parcel && typeof data.parcel === "object" ? data.parcel : {};

  return {
    productId: legacyProductId,
    priceId: legacyPriceId,
    stripe: {
      test: {
        productId: testStripe.productId || testStripe.stripeProductId || legacyProductId,
        priceId: testStripe.priceId || testStripe.stripePriceId || legacyPriceId,
      },
      live: {
        productId: liveStripe.productId || liveStripe.stripeProductId || "",
        priceId: liveStripe.priceId || liveStripe.stripePriceId || "",
      },
    },
    amount: Math.max(0, Number(data.amount || 0)),
    weightGrams: Math.max(0, Number(data.weightGrams || 0)),
    parcel: {
      heightCm: Math.max(0, Number(parcel.heightCm || data.parcelHeightCm || 0)),
      widthCm: Math.max(0, Number(parcel.widthCm || data.parcelWidthCm || 0)),
      lengthCm: Math.max(0, Number(parcel.lengthCm || data.parcelLengthCm || 0)),
    },
    currency: (data.currency || "eur").toLowerCase(),
    name: data.name || id,
    nameEl: data.nameEl || data.name || id,
    description: data.description || "",
    descriptionEl: data.descriptionEl || data.description || "",
    detail: data.detail || data.description || "",
    detailEl: data.detailEl || data.detail || data.descriptionEl || "",
    image: data.image || "",
    imageBg: data.imageBg || "#f8f1eb",
    active: data.active !== false,
    sortOrder: Number(data.sortOrder || 0),
    stock: Number.isFinite(Number(data.stock)) ? Math.max(0, Number(data.stock)) : null,
  };
}

function productToPublic(id, product) {
  const stripe = product.stripe || {};
  return {
    id,
    active: product.active !== false,
    sortOrder: Number(product.sortOrder || 0),
    name: product.name || id,
    nameEl: product.nameEl || product.name || id,
    description: product.description || "",
    descriptionEl: product.descriptionEl || product.description || "",
    detail: product.detail || product.description || "",
    detailEl: product.detailEl || product.detail || product.descriptionEl || "",
    image: product.image || "",
    imageBg: product.imageBg || "#f8f1eb",
    amount: Math.max(0, Number(product.amount || 0)),
    currency: product.currency || "eur",
    weightGrams: Math.max(0, Number(product.weightGrams || 0)),
    parcel: product.parcel || {},
    stripeProductId: product.productId || "",
    stripePriceId: product.priceId || "",
    stock: Number.isFinite(Number(product.stock)) ? Math.max(0, Number(product.stock)) : null,
    stripe,
  };
}

function stripeRefsForProduct(product = {}, mode = "test") {
  const stripe = product.stripe || {};
  const refs = mode === "live" ? stripe.live || {} : stripe.test || {};
  return {
    productId: refs.productId || (mode === "test" ? product.productId || "" : ""),
    priceId: refs.priceId || (mode === "test" ? product.priceId || "" : ""),
  };
}

async function getProductsMap({ includeInactive = false } = {}) {
  const snap = await db.collection("products").get();
  const map = {};
  snap.forEach((doc) => {
    const product = productDocToRuntime(doc.id, doc.data());
    if (includeInactive || product.active !== false) map[doc.id] = product;
  });
  PRODUCTS_MAP = map;
  return map;
}

function sanitizeProductPayload(input = {}) {
  const id = String(input.id || "").trim();
  if (!id) throw new Error("Missing product id");
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(id)) {
    throw new Error("Product id must use lowercase letters, numbers, and hyphens");
  }

  const amount = Math.round(Number(input.amount ?? input.priceCents ?? 0));
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid price amount");

  return {
    id,
    active: input.active !== false,
    sortOrder: Number(input.sortOrder || 0),
    name: String(input.name || id).trim(),
    nameEl: String(input.nameEl || input.name || id).trim(),
    description: String(input.description || "").trim(),
    descriptionEl: String(input.descriptionEl || input.description || "").trim(),
    detail: String(input.detail || input.description || "").trim(),
    detailEl: String(input.detailEl || input.detail || input.descriptionEl || "").trim(),
    image: String(input.image || "").trim(),
    imageBg: String(input.imageBg || "#f8f1eb").trim(),
    amount,
    currency: String(input.currency || "eur").trim().toLowerCase(),
    weightGrams: Math.max(0, Math.round(Number(input.weightGrams || 0))),
    parcel: {
      heightCm: Math.max(0, Number(input.parcel?.heightCm || input.parcelHeightCm || 0)),
      widthCm: Math.max(0, Number(input.parcel?.widthCm || input.parcelWidthCm || 0)),
      lengthCm: Math.max(0, Number(input.parcel?.lengthCm || input.parcelLengthCm || 0)),
    },
    stripeProductId: String(input.stripeProductId || input.productId || "").trim(),
    stripePriceId: String(input.stripePriceId || input.priceId || "").trim(),
    stripe: {
      test: {
        productId: String(input.stripe?.test?.productId || input.stripeTestProductId || input.stripeProductId || input.productId || "").trim(),
        priceId: String(input.stripe?.test?.priceId || input.stripeTestPriceId || input.stripePriceId || input.priceId || "").trim(),
      },
      live: {
        productId: String(input.stripe?.live?.productId || input.stripeLiveProductId || "").trim(),
        priceId: String(input.stripe?.live?.priceId || input.stripeLivePriceId || "").trim(),
      },
    },
    stock: input.stock === "" || input.stock == null ? null : Math.max(0, Math.round(Number(input.stock || 0))),
    updatedAt: now(),
  };
}

async function requireAdmin(req) {
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const decoded = await getAdminAuth().verifyIdToken(m[1]);
  if (!decoded.admin) throw Object.assign(new Error("Forbidden"), { status: 403 });
  return decoded;
}

function adminError(res, err) {
  const status = Number(err.status || 400);
  return jsonError(res, status, err.message || "Admin request failed");
}

function parseImageUpload(body = {}) {
  const id = String(body.productId || body.id || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(id)) {
    throw new Error("Missing or invalid product id");
  }

  const dataUrl = String(body.imageDataUrl || "");
  const match = dataUrl.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error("Upload a PNG, JPG, or WebP image");

  const contentType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) throw new Error("Image file is empty");
  if (buffer.length > 5 * 1024 * 1024) throw new Error("Image must be 5 MB or smaller");

  const ext = contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1];
  return { id, contentType, buffer, ext };
}

function generateOrderNumber() {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `GRZ-${stamp}-${random}`;
}

function publicOrderId(orderOrMetadata = {}) {
  return orderOrMetadata.orderNumber || orderOrMetadata.internalOrderId || orderOrMetadata.id || "";
}

function parseSessionCart(session, productsMap) {
  let raw = [];
  try {
    raw = JSON.parse(session?.metadata?.cart || "[]");
  } catch {
    raw = [];
  }
  return (Array.isArray(raw) ? raw : []).map(({ id, qty }) => {
    const product = productsMap[id] || {};
    const stripeRefs = stripeRefsForProduct(product, session?.metadata?.stripeMode || "test");
    const quantity = Math.max(1, Number(qty || 0));
    const unitAmount = Math.max(0, Number(product.amount || 0));
    return {
      id,
      name: product.name || id,
      quantity,
      unitAmount,
      currency: product.currency || session.currency || "eur",
      totalAmount: unitAmount * quantity,
      stripeProductId: stripeRefs.productId || "",
      stripePriceId: stripeRefs.priceId || "",
      image: product.image || "",
    };
  });
}

function orderItemsFromCart(items, productsMap, stripeMode = "test") {
  return (Array.isArray(items) ? items : []).map(({ id, qty }) => {
    const product = productsMap[id] || {};
    if (!product.name && !productsMap[id]) throw new Error(`Unknown product id: ${id}`);
    if (product.active === false) throw new Error(`Inactive product id: ${id}`);
    const stripeRefs = stripeRefsForProduct(product, stripeMode);
    const quantity = Math.max(1, Number(qty || 0));
    const unitAmount = Math.max(0, Number(product.amount || 0));
    return {
      id,
      name: product.name || id,
      quantity,
      unitAmount,
      currency: product.currency || "eur",
      totalAmount: unitAmount * quantity,
      stripeProductId: stripeRefs.productId || "",
      stripePriceId: stripeRefs.priceId || "",
      image: product.image || "",
    };
  });
}

function normalizeCouponCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function couponDocId(code) {
  return normalizeCouponCode(code).toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
}

function centsFromEuroValue(value) {
  if (value == null || value === "") return 0;
  const n = Number(String(value).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) throw new Error("Invalid amount");
  return Math.round(n * 100);
}

function couponDateMillis(value) {
  if (!value) return 0;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (value._seconds) return value._seconds * 1000;
  if (value.seconds) return value.seconds * 1000;
  if (typeof value.toMillis === "function") return value.toMillis();
  return 0;
}

function couponTimestampFromInput(value, fieldLabel) {
  if (value == null || value === "") return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error(`${fieldLabel} date is invalid`);
  return Timestamp.fromMillis(ms);
}

function sanitizeCouponPayload(input = {}, existing = {}) {
  const code = normalizeCouponCode(input.code || existing.code);
  if (!code) throw new Error("Coupon code is required");
  if (!/^[A-Z0-9][A-Z0-9_-]{1,40}$/.test(code)) {
    throw new Error("Coupon code must use letters, numbers, dashes, or underscores");
  }
  const type = String(input.type || existing.type || "percent").trim().toLowerCase();
  if (type !== "percent" && type !== "fixed") throw new Error("Coupon type must be percent or fixed");
  const percentOff = type === "percent" ? Number(input.percentOff ?? existing.percentOff ?? 0) : 0;
  if (type === "percent" && (!Number.isFinite(percentOff) || percentOff <= 0 || percentOff > 100)) {
    throw new Error("Percent discount must be between 1 and 100");
  }
  const amountOffCents = type === "fixed"
    ? Math.round(Number(input.amountOffCents ?? existing.amountOffCents ?? centsFromEuroValue(input.amountOffEuro)))
    : 0;
  if (type === "fixed" && (!Number.isFinite(amountOffCents) || amountOffCents <= 0)) {
    throw new Error("Fixed discount amount is required");
  }
  const minimumSubtotalCents = Math.max(0, Math.round(Number(input.minimumSubtotalCents ?? existing.minimumSubtotalCents ?? centsFromEuroValue(input.minimumSubtotalEuro))));
  const maxRedemptions = input.maxRedemptions === "" || input.maxRedemptions == null
    ? Number(existing.maxRedemptions || 0)
    : Math.max(0, Math.round(Number(input.maxRedemptions || 0)));
  const maxRedemptionsPerCustomer = input.maxRedemptionsPerCustomer === "" || input.maxRedemptionsPerCustomer == null
    ? Number(existing.maxRedemptionsPerCustomer || 0)
    : Math.max(0, Math.round(Number(input.maxRedemptionsPerCustomer || 0)));
  const allowedProductIds = Array.isArray(input.allowedProductIds)
    ? input.allowedProductIds.map(id => String(id || "").trim()).filter(Boolean).slice(0, 100)
    : Array.isArray(existing.allowedProductIds) ? existing.allowedProductIds : [];
  return {
    code,
    active: input.active == null ? existing.active !== false : input.active !== false,
    type,
    percentOff: type === "percent" ? Math.round(percentOff * 100) / 100 : 0,
    amountOffCents,
    currency: String(input.currency || existing.currency || "eur").trim().toLowerCase(),
    minimumSubtotalCents,
    maxRedemptions,
    maxRedemptionsPerCustomer,
    allowedProductIds,
    startsAt: Object.prototype.hasOwnProperty.call(input, "startsAt")
      ? couponTimestampFromInput(input.startsAt, "Start")
      : existing.startsAt || null,
    endsAt: Object.prototype.hasOwnProperty.call(input, "endsAt")
      ? couponTimestampFromInput(input.endsAt, "End")
      : existing.endsAt || null,
    description: String(input.description || existing.description || "").trim().slice(0, 500),
    stripePromotionCodes: existing.stripePromotionCodes || {},
    redemptionCount: Math.max(0, Number(existing.redemptionCount || 0)),
    updatedAt: now(),
  };
}

function couponToPublic(id, coupon = {}) {
  return {
    id,
    code: coupon.code || id,
    active: coupon.active !== false,
    type: coupon.type || "percent",
    percentOff: Number(coupon.percentOff || 0),
    amountOffCents: Number(coupon.amountOffCents || 0),
    currency: coupon.currency || "eur",
    minimumSubtotalCents: Number(coupon.minimumSubtotalCents || 0),
    maxRedemptions: Number(coupon.maxRedemptions || 0),
    maxRedemptionsPerCustomer: Number(coupon.maxRedemptionsPerCustomer || 0),
    redemptionCount: Number(coupon.redemptionCount || 0),
    allowedProductIds: Array.isArray(coupon.allowedProductIds) ? coupon.allowedProductIds : [],
    startsAt: coupon.startsAt || null,
    endsAt: coupon.endsAt || null,
    description: coupon.description || "",
    stripePromotionCodes: coupon.stripePromotionCodes || {},
  };
}

const DEFAULT_SOCIAL_AGENT_SETTINGS = {
  enabled: true,
  minScore: 4,
  maxResultsPerScan: 25,
  productLink: "https://www.grubz.gr/#products",
  brandContext: "GRUBZ is a Greece-based brand selling dried black soldier fly larvae snacks for reptiles, backyard chickens, birds, aquarium fish, and pond fish. The agent should look for helpful, non-pushy opportunities to mention BSFL as a high-protein treat or feeder option, especially when people ask about nutrition, variety, mealworm alternatives, picky eaters, or natural animal snacks. Comments must be transparent, practical, and friendly, with disclosure when linking to GRUBZ.",
  keywords: [
    "black soldier fly larvae",
    "black soldier fly larva",
    "black soldier fly",
    "bsfl",
    "calci worms",
    "phoenix worms",
    "dried larvae",
    "dried insects",
    "feeder insects",
    "feeder insect",
    "insect protein",
    "high protein treats",
    "mealworms alternative",
    "mealworm alternative",
    "dried mealworms",
    "bearded dragon food",
    "bearded dragon treats",
    "bearded dragon diet",
    "gecko food",
    "leopard gecko food",
    "reptile food",
    "reptile treats",
    "reptile feeder",
    "chicken protein",
    "chicken treats",
    "hen treats",
    "backyard chickens",
    "poultry treats",
    "bird treats",
    "wild bird food",
    "parrot treats",
    "aquarium fish food",
    "fish treats",
    "pond fish food",
    "koi food",
    "turtle food",
    "natural pet treats",
    "sustainable pet food",
  ],
  negativeKeywords: [
    "human food",
    "for people",
    "recipe",
    "restaurant",
    "allergy",
    "pest control",
    "maggots in house",
    "infestation",
    "fly problem",
    "compost bin problem",
    "medical",
    "disease",
    "parasite",
    "gross",
    "spam",
    "giveaway",
    "job",
    "hiring",
  ],
  sources: [
    {
      id: "reddit-reptiles-bsfl",
      label: "Reddit reptiles BSFL search",
      url: "https://www.reddit.com/r/reptiles/search.rss?q=black%20soldier%20fly%20larvae%20OR%20bsfl%20OR%20feeder%20insects&restrict_sr=1&sort=new",
      enabled: true,
    },
    {
      id: "reddit-beardeddragons-food",
      label: "Reddit bearded dragons food",
      url: "https://www.reddit.com/r/BeardedDragons/search.rss?q=food%20OR%20treats%20OR%20bsfl%20OR%20mealworms&restrict_sr=1&sort=new",
      enabled: true,
    },
    {
      id: "reddit-geckos-feeders",
      label: "Reddit geckos feeders",
      url: "https://www.reddit.com/r/geckos/search.rss?q=food%20OR%20feeder%20OR%20bsfl%20OR%20mealworms&restrict_sr=1&sort=new",
      enabled: true,
    },
    {
      id: "reddit-backyardchickens-treats",
      label: "Reddit backyard chickens treats",
      url: "https://www.reddit.com/r/BackYardChickens/search.rss?q=treats%20OR%20protein%20OR%20mealworms&restrict_sr=1&sort=new",
      enabled: true,
    },
    {
      id: "reddit-chickens-protein",
      label: "Reddit chickens protein",
      url: "https://www.reddit.com/r/chickens/search.rss?q=treats%20OR%20protein%20OR%20mealworms%20OR%20bsfl&restrict_sr=1&sort=new",
      enabled: true,
    },
    {
      id: "reddit-aquariums-fishfood",
      label: "Reddit aquariums food",
      url: "https://www.reddit.com/r/Aquariums/search.rss?q=fish%20food%20OR%20protein%20OR%20dried%20insects&restrict_sr=1&sort=new",
      enabled: true,
    },
    {
      id: "reddit-ponds-koi-food",
      label: "Reddit ponds koi food",
      url: "https://www.reddit.com/r/ponds/search.rss?q=koi%20food%20OR%20fish%20food%20OR%20protein%20OR%20treats&restrict_sr=1&sort=new",
      enabled: true,
    },
    {
      id: "reddit-parrots-treats",
      label: "Reddit parrots treats",
      url: "https://www.reddit.com/r/parrots/search.rss?q=treats%20OR%20protein%20OR%20dried%20insects&restrict_sr=1&sort=new",
      enabled: true,
    },
    {
      id: "google-news-bsfl-pet-food",
      label: "Google News BSFL pet food",
      url: "https://news.google.com/rss/search?q=%22black%20soldier%20fly%22%20pet%20food%20OR%20BSFL%20pet%20food&hl=en&gl=US&ceid=US:en",
      enabled: true,
    },
    {
      id: "google-news-insect-protein-pets",
      label: "Google News insect protein pets",
      url: "https://news.google.com/rss/search?q=%22insect%20protein%22%20pets%20OR%20reptiles%20OR%20chickens%20OR%20fish&hl=en&gl=US&ceid=US:en",
      enabled: true,
    },
  ],
};

function splitLines(value) {
  return String(value || "").split(/\r?\n|,/).map(item => item.trim()).filter(Boolean);
}

function sanitizeSocialAgentSettings(input = {}, existing = {}) {
  const merged = { ...DEFAULT_SOCIAL_AGENT_SETTINGS, ...(existing || {}), ...(input || {}) };
  const rawSources = Array.isArray(input.sources)
    ? input.sources
    : Array.isArray(existing.sources) && existing.sources.length ? existing.sources : DEFAULT_SOCIAL_AGENT_SETTINGS.sources;
  const sources = rawSources
    .map((source = {}, index) => ({
      id: String(source.id || `source-${index + 1}`).trim().replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || `source-${index + 1}`,
      label: String(source.label || source.url || `Source ${index + 1}`).trim().slice(0, 120),
      url: String(source.url || "").trim(),
      enabled: source.enabled !== false,
    }))
    .filter(source => {
      try {
        const url = new URL(source.url);
        return url.protocol === "https:";
      } catch {
        return false;
      }
    })
    .slice(0, 12);
  const keywords = splitLines(Array.isArray(merged.keywords) ? merged.keywords.join("\n") : merged.keywords);
  const negativeKeywords = splitLines(Array.isArray(merged.negativeKeywords) ? merged.negativeKeywords.join("\n") : merged.negativeKeywords);
  return {
    enabled: merged.enabled !== false,
    minScore: Math.min(20, Math.max(1, Math.round(Number(merged.minScore || 4)))),
    maxResultsPerScan: Math.min(50, Math.max(5, Math.round(Number(merged.maxResultsPerScan || 25)))),
    productLink: String(merged.productLink || DEFAULT_SOCIAL_AGENT_SETTINGS.productLink).trim().slice(0, 300),
    brandContext: String(merged.brandContext || DEFAULT_SOCIAL_AGENT_SETTINGS.brandContext).trim().slice(0, 1000),
    keywords: (keywords.length ? keywords : DEFAULT_SOCIAL_AGENT_SETTINGS.keywords).slice(0, 60),
    negativeKeywords: (negativeKeywords.length ? negativeKeywords : DEFAULT_SOCIAL_AGENT_SETTINGS.negativeKeywords).slice(0, 40),
    sources: sources.length ? sources : DEFAULT_SOCIAL_AGENT_SETTINGS.sources,
  };
}

async function getSocialAgentSettings() {
  const snap = await db.doc(SOCIAL_AGENT_SETTINGS_DOC).get();
  return sanitizeSocialAgentSettings({}, snap.exists ? snap.data() : {});
}

function decodeXml(value = "") {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstXml(block = "", tag = "") {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return decodeXml(match?.[1] || "");
}

function firstXmlLink(block = "") {
  const atom = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
  if (atom?.[1]) return decodeXml(atom[1]);
  return firstXml(block, "link");
}

function parseFeedItems(xml = "", source = {}) {
  const blocks = [...String(xml || "").matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)]
    .map(match => match[2])
    .slice(0, 40);
  return blocks.map(block => {
    const title = firstXml(block, "title");
    const url = firstXmlLink(block);
    const summary = firstXml(block, "description") || firstXml(block, "summary") || firstXml(block, "content");
    const publishedAt = firstXml(block, "pubDate") || firstXml(block, "updated") || firstXml(block, "published");
    return {
      sourceId: source.id || "",
      sourceLabel: source.label || source.url || "",
      title,
      url,
      summary,
      publishedAt,
    };
  }).filter(item => item.title && item.url);
}

function socialOpportunityId(url = "") {
  return createHash("sha256").update(String(url || "")).digest("hex").slice(0, 40);
}

function scoreSocialItem(item = {}, settings = {}) {
  const text = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  const matchedKeywords = [];
  for (const keyword of settings.keywords || []) {
    const key = String(keyword || "").toLowerCase();
    if (key && text.includes(key)) matchedKeywords.push(keyword);
  }
  const negativeMatches = [];
  for (const keyword of settings.negativeKeywords || []) {
    const key = String(keyword || "").toLowerCase();
    if (key && text.includes(key)) negativeMatches.push(keyword);
  }
  let score = matchedKeywords.length * 2 - negativeMatches.length * 4;
  if (/\b(question|help|advice|recommend|protein|treat|feed|food|diet)\b/i.test(text)) score += 2;
  if (/\b(bsf|bsfl|black soldier fly|larvae|insect protein)\b/i.test(text)) score += 3;
  if (/\b(reptile|bearded dragon|gecko|chicken|hen|fish|aquarium|pond)\b/i.test(text)) score += 2;
  return { score: Math.max(0, score), matchedKeywords, negativeMatches };
}

function socialAudience(item = {}) {
  const text = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  if (/\b(chicken|hen|backyard)\b/.test(text)) return "chicken keepers";
  if (/\b(fish|aquarium|pond)\b/.test(text)) return "fish keepers";
  if (/\b(gecko|bearded dragon|reptile|lizard)\b/.test(text)) return "reptile keepers";
  return "pet owners";
}

function draftSocialComment(item = {}, settings = {}, score = {}) {
  const audience = socialAudience(item);
  const matched = (score.matchedKeywords || []).slice(0, 3).join(", ");
  return [
    `Useful thread for ${audience}. One angle worth considering is dried black soldier fly larvae: they are a high-protein snack and can be a handy alternative to the usual dried insects when used as part of a balanced diet.`,
    `Full disclosure: I am with GRUBZ, we pack dried BSFL snacks in Greece. This looked relevant because of ${matched || "the feeding topic"}.`,
    `Product info: ${settings.productLink || DEFAULT_SOCIAL_AGENT_SETTINGS.productLink}`,
  ].join("\n\n");
}

function publicSocialOpportunity(id, data = {}) {
  return {
    id,
    sourceId: data.sourceId || "",
    sourceLabel: data.sourceLabel || "",
    title: data.title || "",
    url: data.url || "",
    summary: data.summary || "",
    publishedAt: data.publishedAt || "",
    score: Number(data.score || 0),
    matchedKeywords: Array.isArray(data.matchedKeywords) ? data.matchedKeywords : [],
    status: data.status || "new",
    draftComment: data.draftComment || "",
    notes: data.notes || "",
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    scannedAt: data.scannedAt || null,
  };
}

function sanitizeChatText(value = "", max = 3000) {
  return String(value || "").trim().replace(/\s+\n/g, "\n").slice(0, max);
}

function publicChatConversation(id, data = {}) {
  const customer = data.customer && typeof data.customer === "object" ? data.customer : {};
  return {
    id,
    status: data.status || "open",
    customer: {
      name: customer.name || "",
      email: customer.email || data.email || "",
      uid: customer.uid || data.uid || "",
      guestId: customer.guestId || data.guestId || "",
    },
    lastMessageText: data.lastMessageText || "",
    lastMessageAt: data.lastMessageAt || null,
    unreadAdmin: Number(data.unreadAdmin || 0),
    unreadCustomer: Number(data.unreadCustomer || 0),
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
  };
}

function publicChatMessage(id, data = {}) {
  return {
    id,
    conversationId: data.conversationId || "",
    sender: data.sender || "customer",
    senderName: data.senderName || "",
    text: data.text || "",
    createdAt: data.createdAt || null,
    createdBy: data.createdBy || "",
  };
}

function chatCustomerFromRequest(body = {}, authUser = null) {
  const customer = body.customer && typeof body.customer === "object" ? body.customer : {};
  return {
    uid: authUser?.uid || "",
    email: authUser?.email || sanitizeChatText(customer.email || body.email || "", 240),
    name: sanitizeChatText(customer.name || body.name || authUser?.name || authUser?.email || "", 180),
    guestId: sanitizeChatText(body.guestId || customer.guestId || "", 160),
  };
}

function mergeChatCustomer(existing = {}, incoming = {}) {
  return {
    uid: incoming.uid || existing.uid || "",
    email: incoming.email || existing.email || "",
    name: incoming.name || existing.name || "",
    guestId: incoming.guestId || existing.guestId || "",
  };
}

function canAccessChatConversation(conversation = {}, customer = {}) {
  if (customer.uid && (conversation.customer?.uid || conversation.uid) === customer.uid) return true;
  if (customer.guestId && (conversation.customer?.guestId || conversation.guestId) === customer.guestId) return true;
  return false;
}

async function chatMessagesForConversation(conversationId, limit = 100) {
  const snap = await db.collection(CHAT_CONVERSATIONS_COLLECTION).doc(conversationId)
    .collection("messages")
    .orderBy("createdAt", "asc")
    .limit(Math.min(200, Math.max(1, Number(limit || 100))))
    .get();
  return snap.docs.map(doc => publicChatMessage(doc.id, doc.data()));
}

async function scanSocialAgent(settings = {}, adminUser = {}) {
  if (settings.enabled === false) throw Object.assign(new Error("Social Agent is disabled"), { status: 400 });
  const sources = (settings.sources || []).filter(source => source.enabled !== false);
  const opportunities = [];
  const errors = [];
  for (const source of sources) {
    try {
      const response = await fetch(source.url, {
        headers: {
          "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
          "User-Agent": "GRUBZSocialAgent/1.0 (+https://www.grubz.gr)",
        },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const xml = (await response.text()).slice(0, 1_000_000);
      for (const item of parseFeedItems(xml, source)) {
        const scored = scoreSocialItem(item, settings);
        if (scored.score < settings.minScore) continue;
        const id = socialOpportunityId(item.url);
        opportunities.push({
          id,
          ...item,
          score: scored.score,
          matchedKeywords: scored.matchedKeywords,
          negativeMatches: scored.negativeMatches,
          draftComment: draftSocialComment(item, settings, scored),
          status: "new",
          scannedAt: now(),
          updatedAt: now(),
          updatedBy: adminUser.uid || "",
        });
      }
    } catch (err) {
      errors.push({ sourceId: source.id, label: source.label, error: err.message || "Scan failed" });
    }
  }
  opportunities.sort((a, b) => b.score - a.score);
  const selected = opportunities.slice(0, settings.maxResultsPerScan);
  const batch = db.batch();
  for (const opportunity of selected) {
    const ref = db.collection(SOCIAL_OPPORTUNITIES_COLLECTION).doc(opportunity.id);
    const snap = await ref.get();
    batch.set(ref, {
      ...opportunity,
      createdAt: snap.exists ? snap.data()?.createdAt || now() : now(),
      status: snap.exists ? snap.data()?.status || opportunity.status : opportunity.status,
      notes: snap.exists ? snap.data()?.notes || "" : "",
    }, { merge: true });
  }
  if (selected.length) await batch.commit();
  return { opportunities: selected.map(item => publicSocialOpportunity(item.id, item)), errors };
}

async function importManualSocialItems(items = [], settings = {}, adminUser = {}) {
  const prepared = (Array.isArray(items) ? items : [])
    .map((item = {}, index) => {
      const title = String(item.title || `Facebook group post ${index + 1}`).trim().slice(0, 240);
      const summary = String(item.summary || item.text || "").trim().slice(0, 5000);
      const url = String(item.url || "").trim();
      if (!summary && !url) return null;
      const sourceLabel = String(item.sourceLabel || "Facebook group manual intake").trim().slice(0, 120);
      const base = {
        sourceId: "facebook-manual",
        sourceLabel,
        title,
        url: url || `manual:facebook:${createHash("sha256").update(`${title}:${summary}`).digest("hex").slice(0, 24)}`,
        summary,
        publishedAt: String(item.publishedAt || "").trim().slice(0, 120),
      };
      const scored = scoreSocialItem(base, settings);
      return {
        id: socialOpportunityId(`${base.url}:${base.title}:${base.summary}`),
        ...base,
        score: scored.score,
        matchedKeywords: scored.matchedKeywords,
        negativeMatches: scored.negativeMatches,
        draftComment: draftSocialComment(base, settings, scored),
        status: "new",
        scannedAt: now(),
        updatedAt: now(),
        updatedBy: adminUser.uid || "",
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, settings.maxResultsPerScan || 25);
  const batch = db.batch();
  for (const opportunity of prepared) {
    const ref = db.collection(SOCIAL_OPPORTUNITIES_COLLECTION).doc(opportunity.id);
    const snap = await ref.get();
    batch.set(ref, {
      ...opportunity,
      createdAt: snap.exists ? snap.data()?.createdAt || now() : now(),
      status: snap.exists ? snap.data()?.status || opportunity.status : opportunity.status,
      notes: snap.exists ? snap.data()?.notes || "" : "",
    }, { merge: true });
  }
  if (prepared.length) await batch.commit();
  return prepared.map(item => publicSocialOpportunity(item.id, item));
}

function socialWebhookItems(body = {}) {
  const rawItems = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.posts)
      ? body.posts
      : Array.isArray(body.comments)
        ? body.comments
        : [body];
  return rawItems.map((item = {}, index) => ({
    title: item.title || item.postTitle || item.groupName || `Social post ${index + 1}`,
    summary: item.summary || item.text || item.body || item.content || item.comment || item.message || "",
    url: item.url || item.link || item.permalink || item.postUrl || "",
    sourceLabel: item.sourceLabel || item.source || item.groupName || "Social webhook",
    publishedAt: item.publishedAt || item.createdAt || item.date || "",
  })).filter(item => item.summary || item.url);
}

function couponEligibleSubtotalCents(coupon, orderItems) {
  const allowed = new Set(Array.isArray(coupon.allowedProductIds) ? coupon.allowedProductIds : []);
  return (Array.isArray(orderItems) ? orderItems : []).reduce((sum, item = {}) => {
    if (allowed.size && !allowed.has(item.id)) return sum;
    return sum + Math.max(0, Number(item.totalAmount || 0));
  }, 0);
}

async function customerCouponUsage(couponCode, uid = "", email = "") {
  if (!uid && !email) return 0;
  let query = db.collection("couponRedemptions").where("couponCode", "==", couponCode).limit(1000);
  const snap = await query.get();
  let count = 0;
  snap.forEach(doc => {
    const data = doc.data() || {};
    if ((uid && data.uid === uid) || (email && String(data.customerEmail || "").toLowerCase() === String(email).toLowerCase())) {
      count += 1;
    }
  });
  return count;
}

async function evaluateCoupon({ code, items, productsMap, uid = "", email = "", nowMs = Date.now(), stripeMode = "" }) {
  const normalized = normalizeCouponCode(code);
  if (!normalized) throw new Error("Missing coupon code");
  const snap = await db.collection(COUPONS_COLLECTION).doc(couponDocId(normalized)).get();
  if (!snap.exists) throw new Error("Invalid coupon");
  const coupon = { id: snap.id, ...snap.data() };
  if (coupon.active === false) throw new Error("Invalid coupon");
  const startsAt = couponDateMillis(coupon.startsAt);
  const endsAt = couponDateMillis(coupon.endsAt);
  if (startsAt && nowMs < startsAt) throw new Error("Conditions not met");
  if (endsAt && nowMs > endsAt) throw new Error("Conditions not met");
  if (coupon.maxRedemptions && Number(coupon.redemptionCount || 0) >= Number(coupon.maxRedemptions)) {
    throw new Error("Conditions not met");
  }
  const effectiveStripeMode = sanitizeStripeMode(stripeMode || (await getStripeSettings()).mode || "test");
  const orderItems = orderItemsFromCart(items, productsMap, effectiveStripeMode);
  const eligibleSubtotal = couponEligibleSubtotalCents(coupon, orderItems);
  if (eligibleSubtotal <= 0) throw new Error("Conditions not met");
  if (coupon.minimumSubtotalCents && eligibleSubtotal < Number(coupon.minimumSubtotalCents)) {
    throw new Error("Conditions not met");
  }
  if (coupon.maxRedemptionsPerCustomer) {
    const usage = await customerCouponUsage(coupon.code, uid, email);
    if (usage >= Number(coupon.maxRedemptionsPerCustomer)) throw new Error("Conditions not met");
  }
  let discountCents = 0;
  if (coupon.type === "percent") {
    discountCents = Math.round((eligibleSubtotal * Number(coupon.percentOff || 0)) / 100);
  } else {
    discountCents = Number(coupon.amountOffCents || 0);
  }
  discountCents = Math.max(0, Math.min(Math.round(discountCents), eligibleSubtotal));
  return { coupon, orderItems, eligibleSubtotal, discountCents };
}

async function calculateCouponDiscountCents(couponCode, items, productsMap, context = {}) {
  if (!couponCode) return { discountCents: 0, coupon: null };
  const result = await evaluateCoupon({
    code: couponCode,
    items,
    productsMap,
    uid: context.uid || "",
    email: context.email || "",
    stripeMode: context.stripeMode || "",
  });
  return { discountCents: result.discountCents, coupon: result.coupon };
}

function stripeCouponSyncSignature(coupon, mode, appliesToProducts = []) {
  const payload = JSON.stringify({
    mode,
    type: coupon.type || "percent",
    percentOff: Number(coupon.percentOff || 0),
    amountOffCents: Number(coupon.amountOffCents || 0),
    currency: coupon.currency || "eur",
    appliesToProducts: [...appliesToProducts].sort(),
  });
  return createHash("sha256").update(payload).digest("hex");
}

async function ensureStripePromotionCodeForCoupon(coupon, mode, orderItems = [], stripeConfigOverride = null) {
  const stripeConfig = stripeConfigOverride || await activeStripeConfig();
  if (stripeConfig.mode !== mode) throw new Error("Stripe mode changed while applying coupon");
  const docId = coupon.id || couponDocId(coupon.code);
  const allowed = new Set(Array.isArray(coupon.allowedProductIds) ? coupon.allowedProductIds : []);
  const appliesToProducts = [...new Set((Array.isArray(orderItems) ? orderItems : [])
    .filter(item => !allowed.size || allowed.has(item.id))
    .map(item => String(item.stripeProductId || "").trim())
    .filter(Boolean))];
  const signature = stripeCouponSyncSignature(coupon, mode, appliesToProducts);
  const rememberPromotion = async (promo) => {
    await db.collection(COUPONS_COLLECTION).doc(docId).set({
      stripePromotionCodes: {
        [mode]: {
          couponId: promo.coupon?.id || promo.coupon || "",
          promotionCodeId: promo.id,
          signature,
          syncedAt: now(),
        },
      },
      updatedAt: now(),
    }, { merge: true });
    return promo.id;
  };
  const existing = coupon.stripePromotionCodes?.[mode];
  if (existing?.promotionCodeId && existing.signature === signature) {
    try {
      const promo = await stripeConfig.stripe.promotionCodes.retrieve(existing.promotionCodeId);
      if (promo && promo.active !== false) return promo.id;
    } catch {
      // Recreate below.
    }
  }
  const existingPromos = await stripeConfig.stripe.promotionCodes.list({
    code: coupon.code,
    active: true,
    limit: 10,
  });
  const reusablePromo = existingPromos.data.find(promo => (
    promo.metadata?.grubzCouponCode === coupon.code && promo.metadata?.grubzCouponSignature === signature
  ));
  if (reusablePromo) return rememberPromotion(reusablePromo);
  const couponParams = coupon.type === "percent"
    ? { percent_off: Number(coupon.percentOff || 0), duration: "once" }
    : { amount_off: Number(coupon.amountOffCents || 0), currency: coupon.currency || "eur", duration: "once" };
  if (appliesToProducts.length) {
    couponParams.applies_to = { products: appliesToProducts };
  }
  const stripeCoupon = await stripeConfig.stripe.coupons.create({
    ...couponParams,
    name: `GRUBZ ${coupon.code}`,
    metadata: { grubzCouponCode: coupon.code, grubzCouponId: docId, grubzCouponSignature: signature },
  });
  const promoCode = existingPromos.data.some(item => String(item.code || "").toUpperCase() === coupon.code)
    ? `${coupon.code}-${Date.now().toString(36).toUpperCase()}`
    : coupon.code;
  try {
    const promo = await stripeConfig.stripe.promotionCodes.create({
      coupon: stripeCoupon.id,
      code: promoCode,
      active: coupon.active !== false,
      metadata: { grubzCouponCode: coupon.code, grubzCouponId: docId, grubzCouponSignature: signature },
    });
    return rememberPromotion(promo);
  } catch (err) {
    const promos = await stripeConfig.stripe.promotionCodes.list({ code: coupon.code, active: true, limit: 10 });
    const promo = promos.data.find(item => (
      item.metadata?.grubzCouponCode === coupon.code && item.metadata?.grubzCouponSignature === signature
    ));
    if (promo) return rememberPromotion(promo);
    throw err;
  }
}

async function recordCouponRedemption({ coupon, order, discountCents }) {
  if (!coupon?.code || !order?.id || !discountCents) return;
  const redemptionId = `${couponDocId(coupon.code)}_${order.id}`;
  const redemptionRef = db.collection("couponRedemptions").doc(redemptionId);
  const existing = await redemptionRef.get();
  if (existing.exists) return;
  await redemptionRef.set({
    couponCode: coupon.code,
    couponId: coupon.id || couponDocId(coupon.code),
    orderId: order.id,
    orderNumber: publicOrderId(order),
    uid: order.uid || "",
    customerEmail: order.customer?.email || "",
    discountCents,
    currency: order.currency || coupon.currency || "eur",
    createdAt: now(),
  }, { merge: true });
  await db.collection(COUPONS_COLLECTION).doc(coupon.id || couponDocId(coupon.code)).set({
    redemptionCount: FieldValue.increment(1),
    updatedAt: now(),
  }, { merge: true });
}

async function createCashOnDeliveryOrder({ uid, email, items, shipping, couponCode, productsMap, stripeMode = "" }) {
  const effectiveStripeMode = sanitizeStripeMode(stripeMode || (await getStripeSettings()).mode || "test");
  const orderItems = orderItemsFromCart(items, productsMap, effectiveStripeMode);
  const amountSubtotal = orderItemsSubtotal({ items: orderItems });
  const boxNowFee = await calculateBoxNowFee(items, shipping, productsMap);
  const amountShipping = Number(boxNowFee.amount || 0);
  const couponResult = await calculateCouponDiscountCents(couponCode, items, productsMap, {
    uid,
    email,
    stripeMode: effectiveStripeMode,
  });
  const discountAmount = couponResult.discountCents;
  const amountTotal = Math.max(0, amountSubtotal + amountShipping - discountAmount);
  const boxNow = shipping?.boxNow || {};
  const orderNumber = generateOrderNumber();
  const id = `cod_${orderNumber.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  const order = {
    id,
    orderNumber,
    uid: uid || "guest",
    stripeMode: effectiveStripeMode,
    stripeSessionId: "",
    stripePaymentIntentId: "",
    paymentMethod: "cash_on_delivery",
    status: "pending_payment",
    fulfillmentStatus: "new",
    paymentStatus: "cash_on_delivery_pending",
    amountTotal,
    amountSubtotal,
    amountShipping,
    amountDiscount: discountAmount,
    amountDue: amountTotal,
    currency: "eur",
    items: orderItems,
    customer: {
      email: email || "",
      name: shipping?.name || "",
      phone: shipping?.phone || "",
    },
    shipping: {
      deliveryMethod: shipping?.deliveryMethod || "boxnow",
      name: shipping?.name || "",
      phone: shipping?.phone || "",
      cashOnDelivery: true,
      boxNow: {
        id: boxNow.id || "",
        name: boxNow.name || "",
        postalCode: boxNow.postalCode || "",
        addressLine1: boxNow.addressLine1 || "",
        addressLine2: boxNow.addressLine2 || "",
        lat: boxNow.lat || "",
        lng: boxNow.lng || "",
      },
      trackingNumber: "",
      trackingUrl: "",
    },
    boxnowFee: {
      amount: amountShipping,
      stripeAmount: 0,
      currency: boxNowFee.currency || "eur",
      source: boxNowFee.source || "",
      weightGrams: Number(boxNowFee.weightGrams || 0),
      parcelSize: boxNowFee.parcel?.code || "",
      parcelLabel: boxNowFee.parcel?.label || "",
      parcelCount: Number(boxNowFee.parcel?.count || 0),
      requiredHeightCm: Number(boxNowFee.parcel?.requiredHeightCm || 0),
    },
    couponCode: couponResult.coupon?.code || "",
    couponId: couponResult.coupon?.id || "",
    metadata: {
      orderNumber,
      uid: uid || "guest",
      paymentMethod: "cash_on_delivery",
      cashOnDelivery: "true",
      couponCode: couponResult.coupon?.code || "",
    },
    createdAt: now(),
    updatedAt: now(),
  };

  await db.collection("orders").doc(id).set(order, { merge: true });
  await recordCouponRedemption({ coupon: couponResult.coupon, order, discountCents: discountAmount });
  return order;
}

async function upsertOrderFromSession(session) {
  const productsMap = await getProductsMap({ includeInactive: true });
  const id = session.id;
  const items = parseSessionCart(session, productsMap);
  const metadata = session.metadata || {};
  const orderNumber = publicOrderId(metadata) || generateOrderNumber();
  const metadataShippingAmount = Number(metadata.boxnowFeeAmount || 0);
  const stripeShippingAmount = Number(session.total_details?.amount_shipping || 0);
  const amountShipping = stripeShippingAmount > 0 ? stripeShippingAmount : metadataShippingAmount;
  const amountSubtotal = orderItemsSubtotal({ items }) || Math.max(0, Number(session.amount_subtotal || 0) - amountShipping);
  const order = {
    id,
    orderNumber,
    uid: metadata.uid || "guest",
    stripeMode: metadata.stripeMode || "",
    stripeSessionId: id,
    stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : "",
    paymentMethod: metadata.paymentMethod || "card",
    status: session.payment_status === "paid" ? "paid" : (session.status || "open"),
    fulfillmentStatus: "new",
    paymentStatus: session.payment_status || "",
    amountTotal: Number(session.amount_total || 0),
    amountSubtotal,
    amountShipping,
    currency: session.currency || "eur",
    items,
    customer: {
      email: session.customer_details?.email || session.customer_email || "",
      name: session.customer_details?.name || metadata.shippingName || "",
      phone: session.customer_details?.phone || metadata.shippingPhone || "",
    },
    shipping: {
      deliveryMethod: metadata.deliveryMethod || "boxnow",
      name: metadata.shippingName || session.customer_details?.name || "",
      phone: metadata.shippingPhone || session.customer_details?.phone || "",
      cashOnDelivery: metadata.cashOnDelivery === "true",
      boxNow: {
        id: metadata.boxnowLockerId || "",
        name: metadata.boxnowLockerName || "",
        postalCode: metadata.boxnowLockerPostalCode || "",
        addressLine1: metadata.boxnowLockerAddressLine1 || "",
        addressLine2: metadata.boxnowLockerAddressLine2 || "",
        lat: metadata.boxnowLockerLat || "",
        lng: metadata.boxnowLockerLng || "",
      },
      trackingNumber: "",
      trackingUrl: "",
    },
    boxnowFee: {
      amount: Number(metadata.boxnowFeeAmount || 0),
      stripeAmount: amountShipping,
      currency: metadata.boxnowFeeCurrency || "eur",
      source: metadata.boxnowFeeSource || "",
      weightGrams: Number(metadata.boxnowWeightGrams || 0),
      parcelSize: metadata.boxnowParcelSize || "",
      parcelLabel: metadata.boxnowParcelLabel || "",
      parcelCount: Number(metadata.boxnowParcelCount || 0),
      requiredHeightCm: Number(metadata.boxnowRequiredHeightCm || 0),
    },
    couponCode: metadata.couponCode || "",
    couponId: metadata.couponId || "",
    amountDiscount: Number(session.total_details?.amount_discount || metadata.couponDiscountCents || 0),
    metadata,
    createdAt: session.created ? Timestamp.fromMillis(session.created * 1000) : now(),
    updatedAt: now(),
  };

  await db.collection("orders").doc(id).set(order, { merge: true });
  if (order.couponCode && order.amountDiscount > 0) {
    const couponSnap = await db.collection(COUPONS_COLLECTION).doc(couponDocId(order.couponCode)).get();
    if (couponSnap.exists) {
      await recordCouponRedemption({ coupon: { id: couponSnap.id, ...couponSnap.data() }, order, discountCents: order.amountDiscount });
    }
  }
  return order;
}

async function upsertOrderFromPaymentIntent(intent) {
  const productsMap = await getProductsMap({ includeInactive: true });
  const metadata = intent.metadata || {};
  const sessionLike = { metadata, currency: intent.currency || "eur" };
  const items = parseSessionCart(sessionLike, productsMap);
  const id = metadata.stripeSessionId || intent.id;
  const orderNumber = publicOrderId(metadata) || generateOrderNumber();
  const amountShipping = Number(metadata.boxnowFeeAmount || 0);
  const amountSubtotal = orderItemsSubtotal({ items }) || Math.max(0, Number(intent.amount || 0) - amountShipping);
  const order = {
    id,
    orderNumber,
    uid: metadata.uid || "guest",
    stripeMode: metadata.stripeMode || "",
    stripeSessionId: metadata.stripeSessionId || "",
    stripePaymentIntentId: intent.id,
    paymentMethod: metadata.paymentMethod || "card",
    status: "payment_failed",
    fulfillmentStatus: "new",
    paymentStatus: "failed",
    amountTotal: Number(intent.amount || 0),
    amountSubtotal,
    amountShipping,
    currency: intent.currency || "eur",
    items,
    customer: {
      email: intent.receipt_email || metadata.customerEmail || "",
      name: metadata.shippingName || "",
      phone: metadata.shippingPhone || "",
    },
    shipping: {
      deliveryMethod: metadata.deliveryMethod || "boxnow",
      name: metadata.shippingName || "",
      phone: metadata.shippingPhone || "",
      cashOnDelivery: metadata.cashOnDelivery === "true",
      boxNow: {
        id: metadata.boxnowLockerId || "",
        name: metadata.boxnowLockerName || "",
        postalCode: metadata.boxnowLockerPostalCode || "",
        addressLine1: metadata.boxnowLockerAddressLine1 || "",
        addressLine2: metadata.boxnowLockerAddressLine2 || "",
        lat: metadata.boxnowLockerLat || "",
        lng: metadata.boxnowLockerLng || "",
      },
      trackingNumber: "",
      trackingUrl: "",
    },
    boxnowFee: {
      amount: amountShipping,
      stripeAmount: amountShipping,
      currency: metadata.boxnowFeeCurrency || "eur",
      source: metadata.boxnowFeeSource || "",
      weightGrams: Number(metadata.boxnowWeightGrams || 0),
      parcelSize: metadata.boxnowParcelSize || "",
      parcelLabel: metadata.boxnowParcelLabel || "",
      parcelCount: Number(metadata.boxnowParcelCount || 0),
      requiredHeightCm: Number(metadata.boxnowRequiredHeightCm || 0),
    },
    metadata,
    createdAt: intent.created ? Timestamp.fromMillis(intent.created * 1000) : now(),
    updatedAt: now(),
  };

  await db.collection("orders").doc(id).set(order, { merge: true });
  return order;
}

function formatMoney(amount, currency = "eur") {
  const value = Number(amount || 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: String(currency || "eur").toUpperCase(),
  }).format(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function notificationTitle(type) {
  if (type === "cash_on_delivery_order") return "Cash on delivery order";
  return type === "purchase_failed" ? "Purchase failed" : "Purchase complete";
}

function orderLines(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  if (!items.length) return ["No cart items were available on this event."];
  return items.map((item) => {
    const total = formatMoney(item.totalAmount, item.currency || order.currency);
    return `${item.quantity} x ${item.name || item.id} - ${total}`;
  });
}

function orderItemsSubtotal(order = {}) {
  const items = Array.isArray(order.items) ? order.items : [];
  return items.reduce((sum, item = {}) => {
    const totalAmount = Number(item.totalAmount);
    if (Number.isFinite(totalAmount) && totalAmount > 0) return sum + totalAmount;
    const unitAmount = Number(item.unitAmount || 0);
    const quantity = Math.max(1, Number(item.quantity || 1));
    return sum + (unitAmount * quantity);
  }, 0);
}

function orderPricing(order = {}) {
  const itemSubtotal = orderItemsSubtotal(order);
  const storedSubtotal = Number(order.amountSubtotal || 0);
  const shipping = Number(order.amountShipping || order.boxnowFee?.amount || 0);
  const storedTotal = Number(order.amountTotal || 0);
  const subtotal = itemSubtotal > 0 ? itemSubtotal : (
    storedSubtotal > 0 && !(shipping > 0 && storedSubtotal === storedTotal)
      ? storedSubtotal
      : Math.max(0, storedTotal - shipping)
  );
  const total = storedTotal > 0 ? storedTotal : subtotal + shipping;
  const discount = Math.max(0, subtotal + shipping - total);
  return { subtotal, shipping, discount, total };
}

function millisFromTimestamp(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value._seconds) return Number(value._seconds || 0) * 1000;
  if (value.seconds) return Number(value.seconds || 0) * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function customerKeyForOrder(order = {}) {
  const uid = String(order.uid || "").trim();
  if (uid && uid !== "guest") return `uid:${uid}`;
  const email = String(order.customer?.email || "").trim().toLowerCase();
  return email ? `email:${email}` : "";
}

function publicOrderSummary(order = {}) {
  return {
    id: order.id || "",
    orderNumber: publicOrderId(order),
    status: order.status || "",
    fulfillmentStatus: order.fulfillmentStatus || "",
    amountTotal: Number(order.amountTotal || 0),
    currency: order.currency || "eur",
    createdAt: order.createdAt || null,
  };
}

function mergeCustomerOrder(customer, order = {}) {
  const customerInfo = order.customer || {};
  const shipping = order.shipping || {};
  const email = String(customerInfo.email || "").trim();
  const name = String(customerInfo.name || "").trim();
  const phone = String(customerInfo.phone || shipping.phone || "").trim();
  const createdAtMs = millisFromTimestamp(order.createdAt);
  const total = Number(order.amountTotal || 0);
  const status = String(order.status || "").toLowerCase();

  if (email && !customer.email) customer.email = email;
  if (name && !customer.name) customer.name = name;
  if (phone && !customer.phone) customer.phone = phone;
  if (shipping && Object.keys(shipping).length && !customer.shipping) customer.shipping = shipping;
  customer.orderCount += 1;
  if (status === "paid" || status === "complete" || status === "succeeded") {
    customer.totalSpent += total;
  }
  if (createdAtMs > customer.lastOrderAtMs) {
    customer.lastOrderAtMs = createdAtMs;
    customer.lastOrderAt = order.createdAt || null;
  }
  customer.recentOrders.push(publicOrderSummary(order));
}

function publicCustomerFromDoc(doc) {
  const data = doc.data() || {};
  return {
    key: `uid:${doc.id}`,
    uid: doc.id,
    email: data.email || "",
    name: data.name || data.displayName || "",
    phone: data.phone || "",
    shipping: data.shipping || null,
    notes: data.notes || "",
    tags: Array.isArray(data.tags) ? data.tags : [],
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    orderCount: 0,
    totalSpent: 0,
    currency: "eur",
    lastOrderAt: null,
    lastOrderAtMs: 0,
    recentOrders: [],
  };
}

function boxNowLines(order) {
  const shipping = order.shipping || {};
  const boxNow = shipping.boxNow || {};
  const fee = order.boxnowFee || {};
  const feeAmount = Number(fee.amount || 0);
  return [
    `Delivery method: ${shipping.deliveryMethod || "boxnow"}`,
    `Cash on delivery: ${shipping.cashOnDelivery ? "Yes" : "No"}`,
    `Recipient name: ${shipping.name || "-"}`,
    `Recipient phone: ${shipping.phone || "-"}`,
    `Locker ID: ${boxNow.id || "-"}`,
    `Locker name: ${boxNow.name || "-"}`,
    `Address line 1: ${boxNow.addressLine1 || "-"}`,
    `Address line 2: ${boxNow.addressLine2 || "-"}`,
    `Postal code: ${boxNow.postalCode || "-"}`,
    `Latitude: ${boxNow.lat || "-"}`,
    `Longitude: ${boxNow.lng || "-"}`,
    `BOX NOW fee: ${feeAmount ? formatMoney(feeAmount, fee.currency || order.currency) : "-"}`,
    `Parcel size: ${fee.parcelLabel || fee.parcelSize || "-"}`,
    `Parcel count: ${fee.parcelCount || "-"}`,
    `Fee source: ${fee.source || "-"}`,
    `Shipment weight: ${fee.weightGrams ? `${fee.weightGrams}g` : "-"}`,
  ];
}

function boxNowHtml(order) {
  return boxNowLines(order)
    .map((line) => {
      const [label, ...rest] = line.split(": ");
      return `<strong>${escapeHtml(label)}:</strong> ${escapeHtml(rest.join(": ") || "-")}`;
    })
    .join("<br>\n");
}

function orderDetailsLines(order = {}) {
  const pricing = orderPricing(order);
  const pricingLines = [
    `Subtotal: ${formatMoney(pricing.subtotal, order.currency)}`,
    `Shipping: ${formatMoney(pricing.shipping, order.currency)}`,
  ];
  if (pricing.discount > 0) {
    pricingLines.push(`Discount: -${formatMoney(pricing.discount, order.currency)}`);
  }
  pricingLines.push(`Total: ${formatMoney(pricing.total, order.currency)}`);

  return [
    "Products",
    ...orderLines(order),
    "",
    "Pricing",
    ...pricingLines,
  ];
}

function orderDetailsText(order = {}) {
  return orderDetailsLines(order).join("\n");
}

function buildOrderNotification(type, order, event) {
  const title = notificationTitle(type);
  const orderNumber = publicOrderId(order);
  const subject = `[GRUBZ] ${title}: ${orderNumber}`;
  const customer = order.customer || {};
  const itemLines = orderLines(order);
  const lockerLines = boxNowLines(order);
  const total = formatMoney(order.amountTotal, order.currency);
  const text = [
    title,
    "",
    `Order: ${orderNumber}`,
    `Status: ${order.status || ""}`,
    `Payment status: ${order.paymentStatus || ""}`,
    `Payment method: ${order.paymentMethod || "card"}`,
    `Total: ${total}`,
    "",
    "Customer",
    `Name: ${customer.name || "-"}`,
    `Email: ${customer.email || "-"}`,
    `Phone: ${customer.phone || "-"}`,
    "",
    "BOX NOW locker",
    ...lockerLines,
    "",
    "Items",
    ...itemLines,
    "",
    `Stripe session: ${order.stripeSessionId || "-"}`,
    `Stripe payment intent: ${order.stripePaymentIntentId || "-"}`,
    `Stripe event: ${event?.id || "-"} (${event?.type || "-"})`,
  ].join("\n");

  const htmlItems = itemLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const html = `
    <h2>${escapeHtml(title)}</h2>
    <p><strong>Order:</strong> ${escapeHtml(orderNumber)}</p>
    <p><strong>Status:</strong> ${escapeHtml(order.status || "")}<br>
    <strong>Payment status:</strong> ${escapeHtml(order.paymentStatus || "")}<br>
    <strong>Payment method:</strong> ${escapeHtml(order.paymentMethod || "card")}<br>
    <strong>Total:</strong> ${escapeHtml(total)}</p>
    <h3>Customer</h3>
    <p>${escapeHtml(customer.name || "-")}<br>
    ${escapeHtml(customer.email || "-")}<br>
    ${escapeHtml(customer.phone || "-")}</p>
    <h3>BOX NOW locker</h3>
    <p>${boxNowHtml(order)}</p>
    <h3>Items</h3>
    <ul>${htmlItems}</ul>
    <p><strong>Stripe session:</strong> ${escapeHtml(order.stripeSessionId || "-")}<br>
    <strong>Stripe payment intent:</strong> ${escapeHtml(order.stripePaymentIntentId || "-")}<br>
    <strong>Stripe event:</strong> ${escapeHtml(event?.id || "-")} (${escapeHtml(event?.type || "-")})</p>
  `;

  return { subject, text, html };
}

function buildCustomerSuccessNotification(order) {
  const customer = order.customer || {};
  const itemLines = orderLines(order);
  const total = formatMoney(order.amountTotal, order.currency);
  const orderNumber = publicOrderId(order);
  const subject = `GRUBZ order confirmed: ${orderNumber}`;
  const greeting = customer.name ? `Hi ${customer.name},` : "Hi,";
  const isCod = order.paymentMethod === "cash_on_delivery" || order.shipping?.cashOnDelivery === true;
  const intro = isCod
    ? "Thanks for your order. We received it as cash on delivery and are preparing your GRUBZ delivery."
    : "Thanks for your order. Your payment was successful and we are preparing your GRUBZ delivery.";
  const amountLine = isCod ? `Amount due on delivery: ${total}` : `Total: ${total}`;
  const text = [
    greeting,
    "",
    intro,
    "",
    `Order: ${orderNumber}`,
    amountLine,
    "",
    "BOX NOW locker",
    ...boxNowLines(order),
    "",
    "Items",
    ...itemLines,
    "",
    "We will contact you if anything else is needed.",
    "GRUBZ",
  ].join("\n");
  const htmlItems = itemLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("");
  const html = `
    <p>${escapeHtml(greeting)}</p>
    <p>${escapeHtml(intro)}</p>
    <p><strong>Order:</strong> ${escapeHtml(orderNumber)}<br>
    <strong>${isCod ? "Amount due on delivery" : "Total"}:</strong> ${escapeHtml(total)}</p>
    <h3>BOX NOW locker</h3>
    <p>${boxNowHtml(order)}</p>
    <h3>Items</h3>
    <ul>${htmlItems}</ul>
    <p>We will contact you if anything else is needed.<br>GRUBZ</p>
  `;
  return { subject, text, html };
}

function buildUserSignupNotification(user = {}) {
  const uid = user.uid || "-";
  const email = user.email || "-";
  const displayName = user.displayName || "-";
  const phoneNumber = user.phoneNumber || "-";
  const providers = Array.isArray(user.providerData)
    ? user.providerData.map(provider => provider.providerId).filter(Boolean).join(", ")
    : "";
  const createdAt = new Date().toISOString();
  const subject = `[GRUBZ] New user signup: ${email}`;
  const text = [
    "New GRUBZ user signup",
    "",
    `UID: ${uid}`,
    `Email: ${email}`,
    `Name: ${displayName}`,
    `Phone: ${phoneNumber}`,
    `Provider: ${providers || "-"}`,
    `Created: ${createdAt}`,
  ].join("\n");
  const html = `
    <h2>New GRUBZ user signup</h2>
    <p><strong>UID:</strong> ${escapeHtml(uid)}<br>
    <strong>Email:</strong> ${escapeHtml(email)}<br>
    <strong>Name:</strong> ${escapeHtml(displayName)}<br>
    <strong>Phone:</strong> ${escapeHtml(phoneNumber)}<br>
    <strong>Provider:</strong> ${escapeHtml(providers || "-")}<br>
    <strong>Created:</strong> ${escapeHtml(createdAt)}</p>
  `;
  return { subject, text, html };
}

function normalizeOrderStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function orderStatusDocKey(value) {
  return normalizeOrderStatus(value).replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "unknown";
}

function defaultOrderEmailSettings() {
  return sanitizeOrderEmailSettingsInternal({ templates: ORDER_FULFILLMENT_EMAIL_TEMPLATES }, { includeDefaults: false });
}

function sanitizeOrderEmailSettings(input = {}) {
  return sanitizeOrderEmailSettingsInternal(input, { includeDefaults: true });
}

function sanitizeOrderEmailSettingsInternal(input = {}, { includeDefaults = true } = {}) {
  const templates = Array.isArray(input.templates) ? input.templates : [];
  const sanitized = templates
    .map((template = {}) => {
        const fulfillmentStatus = String(template.fulfillmentStatus || template.status || "").trim();
        const fulfillmentKey = normalizeOrderStatus(fulfillmentStatus);
        return {
          enabled: template.enabled !== false,
          fulfillmentStatus,
          fulfillmentKey,
          status: fulfillmentStatus,
          statusKey: fulfillmentKey,
          subject: String(template.subject || "").trim().slice(0, 180),
          body: String(template.body || "").trim().slice(0, 5000),
        };
      })
    .filter(template => template.fulfillmentStatus && template.fulfillmentKey && template.subject && template.body);

  const merged = includeDefaults ? [...sanitized] : sanitized;
  if (includeDefaults) {
    for (const template of defaultOrderEmailSettings().templates) {
      if (!merged.some(item => item.fulfillmentKey === template.fulfillmentKey)) merged.push(template);
    }
  }

  return {
    templates: merged.slice(0, 30),
    updatedAt: now(),
  };
}

async function getOrderEmailSettings() {
  const snap = await db.doc(ORDER_EMAIL_SETTINGS_DOC).get();
  if (!snap.exists) return defaultOrderEmailSettings();
  return sanitizeOrderEmailSettings(snap.data() || {});
}

function orderStatusTemplateVars(order = {}, previousStatus = "", previousFulfillmentStatus = previousStatus) {
  const customer = order.customer || {};
  const shipping = order.shipping || {};
  const boxNow = shipping.boxNow || {};
  return {
    orderNumber: publicOrderId(order),
    customerName: customer.name || "",
    customerEmail: customer.email || "",
    customerPhone: customer.phone || "",
    status: order.status || "",
    previousStatus,
    fulfillmentStatus: order.fulfillmentStatus || "",
    previousFulfillmentStatus,
    trackingNumber: shipping.trackingNumber || "",
    trackingUrl: shipping.trackingUrl || "",
    total: formatMoney(order.amountTotal, order.currency),
    boxNowLocker: boxNow.name || boxNow.id || "",
    orderDetails: orderDetailsText(order),
  };
}

function renderOrderTemplate(value, vars) {
  return String(value || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    return vars[key] == null ? "" : String(vars[key]);
  });
}

function plainTextToHtml(text) {
  return escapeHtml(text).replace(/\n/g, "<br>\n");
}

function buildOrderStatusEmail(template, order, previousStatus, previousFulfillmentStatus = previousStatus) {
  const vars = orderStatusTemplateVars(order, previousStatus, previousFulfillmentStatus);
  const subject = renderOrderTemplate(template.subject, vars);
  const text = renderOrderTemplate(template.body, vars);
  return { subject, text, html: plainTextToHtml(text) };
}

function sampleOrderForStatusTemplate(fulfillmentStatus) {
  return {
    id: "test-order",
    orderNumber: "GRZ-TEST-123456",
    status: "paid",
    fulfillmentStatus: fulfillmentStatus || "processing",
    amountTotal: 4250,
    amountSubtotal: 3750,
    amountShipping: 500,
    currency: "eur",
    customer: {
      name: "GRUBZ Test Customer",
      email: DEFAULT_NOTIFICATION_EMAIL,
      phone: "+30 210 000 0000",
    },
    shipping: {
      trackingNumber: "TEST123456",
      trackingUrl: "https://www.grubz.gr/#products",
      boxNow: {
        id: "BOXNOW-TEST",
        name: "BOX NOW Test Locker",
      },
    },
    boxnowFee: {
      amount: 500,
      currency: "eur",
      source: "boxnow-parcel-size",
      parcelLabel: "Medium",
      parcelCount: 1,
      weightGrams: 1200,
    },
    items: [
      {
        id: "happy-chicken-1kg",
        name: "Happy Chicken 1kg",
        quantity: 1,
        totalAmount: 2500,
        currency: "eur",
      },
      {
        id: "grubz-500g",
        name: "GRUBZ 500g",
        quantity: 1,
        totalAmount: 1250,
        currency: "eur",
      },
    ],
    stripeSessionId: "cs_test_123456",
    stripePaymentIntentId: "pi_test_123456",
  };
}

async function sendOrderStatusTestEmail(template, adminUser = {}) {
  const sanitized = sanitizeOrderEmailSettings({ templates: [template] }).templates[0];
  if (!sanitized) throw new Error("Enter a valid email template before sending a test.");
  const from = secretValue(ORDER_NOTIFICATION_FROM, defaultNotificationFrom());
  const message = buildOrderStatusEmail(
    sanitized,
    sampleOrderForStatusTemplate(sanitized.fulfillmentStatus),
    "paid",
    "previous_fulfillment"
  );
  const result = await sendEmail({
    to: DEFAULT_NOTIFICATION_EMAIL,
    from,
    subject: `[TEST] ${message.subject}`,
    text: message.text,
    html: message.html,
  });
  await db.collection("orderNotifications").doc(`order_fulfillment_test_${orderStatusDocKey(sanitized.fulfillmentStatus)}_${Date.now()}`).set({
    type: "order_fulfillment_test",
    status: result.skipped ? "skipped" : "sent",
    templateFulfillmentStatus: sanitized.fulfillmentStatus,
    recipient: DEFAULT_NOTIFICATION_EMAIL,
    result,
    createdAt: now(),
    createdBy: adminUser.uid || "",
  });
  return result;
}

function alreadyExistsError(err) {
  return err?.code === 6 || err?.code === "already-exists" || /already exists/i.test(err?.message || "");
}

function defaultNotificationFrom() {
  const smtpUser = secretValue(SMTP_USER);
  return smtpUser ? `GRUBZ Orders <${smtpUser}>` : DEFAULT_NOTIFICATION_FROM;
}

function emailAddressFromHeader(value) {
  const header = String(value || "").trim();
  const match = header.match(/<([^>]+)>/);
  return String(match ? match[1] : header).trim().toLowerCase();
}

function isInfoGrubzSender(from) {
  return emailAddressFromHeader(from) === GRUBZ_INFO_EMAIL;
}

function appendGrubzSignatureToHtml(html) {
  const body = String(html || "");
  if (!body.trim() || body.includes(GRUBZ_SIGNATURE_IMAGE_URL)) return body;
  return `${body}\n${GRUBZ_EMAIL_SIGNATURE_HTML}`;
}

function appendGrubzSignatureToText(text) {
  const body = String(text || "");
  if (!body.trim() || body.includes(GRUBZ_EMAIL_SIGNATURE_TEXT)) return body;
  return `${body}\n\n${GRUBZ_EMAIL_SIGNATURE_TEXT}`;
}

async function sendEmail({ to, from, bcc, subject, text, html }) {
  const user = secretValue(SMTP_USER);
  const pass = secretValue(SMTP_PASS);
  if (!user || !pass) {
    logger.warn("Order email notification skipped: SMTP_USER or SMTP_PASS is not configured");
    return { skipped: true, reason: "missing_smtp_credentials" };
  }

  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user, pass },
    });
  }

  const shouldAppendGrubzSignature = isInfoGrubzSender(from) || emailAddressFromHeader(user) === GRUBZ_INFO_EMAIL;
  const signedHtml = shouldAppendGrubzSignature ? appendGrubzSignatureToHtml(html) : html;
  const signedText = shouldAppendGrubzSignature ? appendGrubzSignatureToText(text) : text;

  const info = await smtpTransporter.sendMail({
    from,
    to,
    bcc,
    subject,
    text: signedText,
    html: signedHtml,
  });
  return {
    messageId: info.messageId || "",
    accepted: info.accepted || [],
    rejected: info.rejected || [],
  };
}

async function sendOrderNotificationOnce(type, order, event) {
  const orderId = order.id || order.stripeSessionId || order.stripePaymentIntentId || event?.id;
  const orderNumber = publicOrderId(order);
  const dedupeId =
    type === "purchase_failed" && order.stripePaymentIntentId
      ? order.stripePaymentIntentId
      : order.stripeSessionId || orderId;
  const notificationRef = db.collection("orderNotifications").doc(`${type}_${dedupeId}`);
  const notificationSnap = await notificationRef.get();
  if (notificationSnap.exists && notificationSnap.data()?.status === "sent") {
    logger.info("Order email notification already sent", { orderId, type });
    return { skipped: true, reason: "already_sent" };
  }

  await notificationRef.set({
      type,
      orderId,
      orderNumber,
      stripeSessionId: order.stripeSessionId || "",
      stripePaymentIntentId: order.stripePaymentIntentId || "",
      eventId: event?.id || "",
      eventType: event?.type || "",
      status: "sending",
      createdAt: notificationSnap.exists ? notificationSnap.data()?.createdAt || now() : now(),
      lastAttemptAt: now(),
    }, { merge: true });

  try {
    const to = secretValue(ORDER_NOTIFICATION_EMAIL, DEFAULT_NOTIFICATION_EMAIL);
    const from = secretValue(ORDER_NOTIFICATION_FROM, defaultNotificationFrom());
    const message = buildOrderNotification(type, order, event);
    const result = await sendEmail({ to, from, ...message });
    await notificationRef.set({
      status: result.skipped ? "skipped" : "sent",
      result,
      updatedAt: now(),
      sentAt: result.skipped ? null : now(),
    }, { merge: true });
    return result;
  } catch (err) {
    await notificationRef.set({
      status: "failed",
      error: err.message || "Email failed",
      updatedAt: now(),
    }, { merge: true });
    throw err;
  }
}

async function sendCustomerSuccessEmailOnce(order, event) {
  const customerEmail = String(order.customer?.email || "").trim();
  if (!customerEmail) {
    logger.warn("Customer success email skipped: order has no customer email", { orderId: order.id });
    return { skipped: true, reason: "missing_customer_email" };
  }

  const orderId = order.id || order.stripeSessionId || event?.id;
  const orderNumber = publicOrderId(order);
  const dedupeId = order.stripeSessionId || orderId;
  const notificationRef = db.collection("orderNotifications").doc(`customer_purchase_complete_${dedupeId}`);
  const notificationSnap = await notificationRef.get();
  if (notificationSnap.exists && notificationSnap.data()?.status === "sent") {
    logger.info("Customer success email already sent", { orderId });
    return { skipped: true, reason: "already_sent" };
  }

  await notificationRef.set({
    type: "customer_purchase_complete",
    orderId,
    orderNumber,
    stripeSessionId: order.stripeSessionId || "",
    stripePaymentIntentId: order.stripePaymentIntentId || "",
    eventId: event?.id || "",
    eventType: event?.type || "",
    customerEmail,
    status: "sending",
    createdAt: notificationSnap.exists ? notificationSnap.data()?.createdAt || now() : now(),
    lastAttemptAt: now(),
  }, { merge: true });

  try {
    const from = secretValue(ORDER_NOTIFICATION_FROM, defaultNotificationFrom());
    const message = buildCustomerSuccessNotification(order);
    const result = await sendEmail({ to: customerEmail, from, ...message });
    await notificationRef.set({
      status: result.skipped ? "skipped" : "sent",
      result,
      updatedAt: now(),
      sentAt: result.skipped ? null : now(),
    }, { merge: true });
    return result;
  } catch (err) {
    await notificationRef.set({
      status: "failed",
      error: err.message || "Email failed",
      updatedAt: now(),
    }, { merge: true });
    throw err;
  }
}

async function sendOrderStatusEmailOnce(order, previousFulfillmentStatus = "") {
  const fulfillmentKey = normalizeOrderStatus(order.fulfillmentStatus);
  const previousFulfillmentKey = normalizeOrderStatus(previousFulfillmentStatus);
  if (!fulfillmentKey || fulfillmentKey === previousFulfillmentKey) {
    return { skipped: true, reason: "fulfillment_unchanged" };
  }

  const customerEmail = String(order.customer?.email || "").trim();
  if (!customerEmail) {
    return { skipped: true, reason: "missing_customer_email" };
  }
  const recipientEmail = customerEmail;
  const bccEmail = GRUBZ_INFO_EMAIL;

  const settings = await getOrderEmailSettings();
  const template = settings.templates.find(item => item.enabled !== false && item.fulfillmentKey === fulfillmentKey);
  if (!template) {
    return { skipped: true, reason: "missing_template" };
  }

  const orderId = order.id || publicOrderId(order);
  const orderNumber = publicOrderId(order);
  const notificationRef = db.collection("orderNotifications").doc(`order_fulfillment_${orderId}_${orderStatusDocKey(fulfillmentKey)}_${Date.now()}`);
  const notificationSnap = await notificationRef.get();

  await notificationRef.set({
    type: "order_fulfillment",
    orderId,
    orderNumber,
    customerEmail,
    recipientEmail,
    bccEmail,
    previousFulfillmentStatus,
    status: "sending",
    orderStatus: order.status || "",
    fulfillmentStatus: order.fulfillmentStatus || "",
    createdAt: notificationSnap.exists ? notificationSnap.data()?.createdAt || now() : now(),
    lastAttemptAt: now(),
  }, { merge: true });

  try {
    const from = secretValue(ORDER_NOTIFICATION_FROM, defaultNotificationFrom());
    const message = buildOrderStatusEmail(template, order, order.status || "", previousFulfillmentStatus);
    const result = await sendEmail({ to: recipientEmail, from, bcc: bccEmail, ...message });
    await notificationRef.set({
      status: result.skipped ? "skipped" : "sent",
      result,
      updatedAt: now(),
      sentAt: result.skipped ? null : now(),
    }, { merge: true });
    return result;
  } catch (err) {
    await notificationRef.set({
      status: "failed",
      error: err.message || "Email failed",
      updatedAt: now(),
    }, { merge: true });
    throw err;
  }
}

async function sendUserSignupNotification(user = {}) {
  const uid = user.uid || user.email || randomUUID();
  const notificationRef = db.collection("userNotifications").doc(`signup_${uid}`);
  const notificationSnap = await notificationRef.get();
  if (notificationSnap.exists && notificationSnap.data()?.status === "sent") {
    logger.info("Signup email notification already sent", { uid: user.uid || "" });
    return { skipped: true, reason: "already_sent" };
  }

  await notificationRef.set({
    type: "user_signup",
    uid: user.uid || "",
    email: user.email || "",
    status: "sending",
    createdAt: notificationSnap.exists ? notificationSnap.data()?.createdAt || now() : now(),
    lastAttemptAt: now(),
  }, { merge: true });

  try {
    const to = secretValue(ORDER_NOTIFICATION_EMAIL, DEFAULT_NOTIFICATION_EMAIL);
    const from = secretValue(ORDER_NOTIFICATION_FROM, defaultNotificationFrom());
    const message = buildUserSignupNotification(user);
    const result = await sendEmail({ to, from, ...message });
    await notificationRef.set({
      status: result.skipped ? "skipped" : "sent",
      result,
      updatedAt: now(),
      sentAt: result.skipped ? null : now(),
    }, { merge: true });
    return result;
  } catch (err) {
    await notificationRef.set({
      status: "failed",
      error: err.message || "Signup email failed",
      updatedAt: now(),
    }, { merge: true });
    throw err;
  }
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

function isLocalHostValue(value = "") {
  return /(^|\/\/|\s)(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(String(value || ""));
}

function isLocalRequest(req) {
  return [
    req.headers.origin,
    req.headers.referer,
    req.headers.host,
    req.headers["x-forwarded-host"],
    req.headers["x-original-host"],
  ].some(isLocalHostValue);
}

exports.verifyCheckout = onRequest(
  { region: "europe-west1", invoker: "public", secrets: STRIPE_SECRETS },
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
      const sid = String(req.query.sid || "").trim();
      if (!sid) return res.status(400).json({ error: "Missing sid" });

      const { stripe } = await activeStripeConfig(req);
      const session = await stripe.checkout.sessions.retrieve(sid);

      if (session?.metadata?.uid && session.metadata.uid !== "guest" && !uid) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (session?.metadata?.uid && session.metadata.uid !== "guest" && session.metadata.uid !== uid) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const paid =
        session?.status === "complete" && session?.payment_status === "paid";

      return res.json({
        paid,
        orderNumber: session?.metadata?.orderNumber || "",
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
  {
    region: "europe-west1",
    secrets: [
      SMTP_USER,
      SMTP_PASS,
      ORDER_NOTIFICATION_EMAIL,
      ORDER_NOTIFICATION_FROM,
    ],
  },
  async (event) => {
    const user = event.data || {};
    const { uid, email } = user;
    const emailKey = normalizedEmail(email);
    if (emailKey) {
      try {
        const existingUser = await getAdminAuth().getUserByEmail(emailKey);
        if (existingUser?.uid && existingUser.uid !== uid) {
          logger.warn("Duplicate signup blocked", {
            attemptedUid: uid || "",
            existingUid: existingUser.uid,
            email: emailKey,
          });
          throw new HttpsError("already-exists", "That email is already registered.");
        }
      } catch (err) {
        if (err instanceof HttpsError) throw err;
        if (err?.code !== "auth/user-not-found") {
          logger.error("Duplicate signup check failed", {
            uid: uid || "",
            email: emailKey,
            error: err.message || "Duplicate signup check failed",
          });
          throw new HttpsError("internal", "Could not verify this email address. Please try again.");
        }
      }
    }
    if (emailKey) {
      const reservationRef = db.collection(EMAIL_RESERVATIONS_COLLECTION).doc(emailReservationDocId(emailKey));
      try {
        await db.runTransaction(async (transaction) => {
          const reservationSnap = await transaction.get(reservationRef);
          const reservedUid = reservationSnap.exists ? reservationSnap.data()?.uid || "" : "";
          if (reservedUid && reservedUid !== uid) {
            throw new HttpsError("already-exists", "That email is already registered.");
          }
          transaction.set(reservationRef, {
            email: emailKey,
            uid: uid || "",
            createdAt: reservationSnap.exists ? reservationSnap.data()?.createdAt || now() : now(),
            updatedAt: now(),
          }, { merge: true });
        });
      } catch (err) {
        if (err instanceof HttpsError) {
          logger.warn("Duplicate signup blocked by email reservation", {
            attemptedUid: uid || "",
            email: emailKey,
          });
          throw err;
        }
        logger.error("Email reservation failed", {
          uid: uid || "",
          email: emailKey,
          error: err.message || "Email reservation failed",
        });
        throw new HttpsError("internal", "Could not reserve this email address. Please try again.");
      }
    }
    try {
      await db.doc(`users/${uid}`).set(
        { email: email || null, emailLower: emailKey || null, createdAt: Timestamp.now(), shipping: null },
        { merge: true }
      );
    } catch (err) {
      console.error("userBootstrap failed", err);
    }

    try {
      await sendUserSignupNotification(user);
    } catch (err) {
      logger.error("Signup email notification failed", {
        uid: uid || "",
        email: email || "",
        error: err.message || "Signup email failed",
      });
    }
    return;
  }
);

async function uidFromBearer(req) {
  const decoded = await authUserFromBearer(req);
  return decoded?.uid || null;
}

async function authUserFromBearer(req) {
  const m = (req.headers.authorization || "").match(/^Bearer (.+)$/);
  if (!m) return null;
  try {
    return await getAdminAuth().verifyIdToken(m[1]);
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

function sanitizeStripeMode(mode) {
  const value = String(mode || "test").trim().toLowerCase();
  if (value !== "test" && value !== "live") throw new Error("Stripe mode must be test or live");
  return value;
}

function sanitizeStripeSettings(input = {}) {
  return {
    mode: sanitizeStripeMode(input.mode || input.stripeMode || "test"),
    updatedAt: now(),
  };
}

async function getStripeSettings() {
  const snap = await db.doc(STRIPE_SETTINGS_DOC).get();
  if (!snap.exists) return { mode: "test" };
  const data = snap.data() || {};
  return { mode: data.mode === "live" ? "live" : "test" };
}

async function effectiveStripeSettings(req = null, options = {}) {
  const settings = await getStripeSettings();
  if (options.forceLocalEnvironment !== false && req && isLocalRequest(req)) {
    return {
      ...settings,
      savedMode: settings.mode,
      mode: "test",
      localEnvironmentForced: true,
    };
  }
  return {
    ...settings,
    savedMode: settings.mode,
    localEnvironmentForced: false,
  };
}

function stripeSecretForMode(mode) {
  if (mode === "live") {
    return secretValue(STRIPE_SECRET_KEY_LIVE);
  }
  return secretValue(STRIPE_SECRET_KEY_TEST, secretValue(STRIPE_SECRET_KEY));
}

function stripeWebhookSecretForMode(mode) {
  if (mode === "live") {
    return secretValue(STRIPE_WEBHOOK_SECRET_LIVE);
  }
  return secretValue(STRIPE_WEBHOOK_SECRET_TEST, secretValue(STRIPE_WEBHOOK_SECRET));
}

async function activeStripeConfig(req = null, options = {}) {
  const settings = await effectiveStripeSettings(req, options);
  const secret = stripeSecretForMode(settings.mode);
  if (!secret) throw new Error(`Stripe ${settings.mode} secret is not configured`);
  return {
    mode: settings.mode,
    savedMode: settings.savedMode,
    localEnvironmentForced: settings.localEnvironmentForced === true,
    secret,
    stripe: stripeClient(secret),
  };
}

function normalizeBoxNowBase() {
  return BOXNOW_API_BASE_URL.replace(/\/+$/, "");
}

function sanitizeBoxNowEnvironment(value) {
  const env = String(value || "stage").trim().toLowerCase();
  if (env === "live") return "production";
  if (!BOXNOW_ENVIRONMENTS[env]) throw new Error("BOX NOW environment must be stage or production");
  return env;
}

function maskedSecret(value) {
  const s = String(value || "");
  if (!s) return "";
  if (s.length <= 8) return "********";
  return `${s.slice(0, 4)}...${s.slice(-4)}`;
}

function defaultBoxNowSettings() {
  return {
    activeEnvironment: "stage",
    stage: {
      clientId: "",
      clientSecret: "",
      partnerId: "",
      webhookSecret: "",
      originLocationId: "",
      originContactName: "GRUBZ",
      originContactEmail: GRUBZ_INFO_EMAIL,
      originContactNumber: "",
    },
    production: {
      clientId: secretValue(BOXNOW_CLIENT_ID),
      clientSecret: secretValue(BOXNOW_CLIENT_SECRET),
      partnerId: secretValue(BOXNOW_PARTNER_ID),
      webhookSecret: "",
      originLocationId: "",
      originContactName: "GRUBZ",
      originContactEmail: GRUBZ_INFO_EMAIL,
      originContactNumber: "",
    },
  };
}

function sanitizeBoxNowEnvConfig(input = {}, existing = {}) {
  const clear = input.clear === true;
  const keepOrValue = (key, max = 2000) => {
    if (clear) return "";
    if (Object.prototype.hasOwnProperty.call(input, key)) {
      return String(input[key] || "").trim().slice(0, max);
    }
    return String(existing[key] || "").trim().slice(0, max);
  };
  return {
    clientId: keepOrValue("clientId"),
    clientSecret: keepOrValue("clientSecret", 4000),
    partnerId: keepOrValue("partnerId"),
    webhookSecret: keepOrValue("webhookSecret", 4000),
    originLocationId: keepOrValue("originLocationId"),
    originContactName: keepOrValue("originContactName") || "GRUBZ",
    originContactEmail: keepOrValue("originContactEmail") || GRUBZ_INFO_EMAIL,
    originContactNumber: keepOrValue("originContactNumber"),
  };
}

function publicBoxNowSettings(settings = {}) {
  const envs = {};
  for (const env of Object.keys(BOXNOW_ENVIRONMENTS)) {
    const config = settings[env] || {};
    envs[env] = {
      clientIdSet: Boolean(config.clientId),
      clientIdMasked: maskedSecret(config.clientId),
      clientSecretSet: Boolean(config.clientSecret),
      clientSecretMasked: maskedSecret(config.clientSecret),
      partnerIdSet: Boolean(config.partnerId),
      partnerIdMasked: maskedSecret(config.partnerId),
      webhookSecretSet: Boolean(config.webhookSecret),
      webhookSecretMasked: maskedSecret(config.webhookSecret),
      originLocationId: config.originLocationId || "",
      originContactName: config.originContactName || "GRUBZ",
      originContactEmail: config.originContactEmail || GRUBZ_INFO_EMAIL,
      originContactNumber: config.originContactNumber || "",
      apiBaseUrl: BOXNOW_ENVIRONMENTS[env].apiBaseUrl,
      locationBaseUrl: BOXNOW_ENVIRONMENTS[env].locationBaseUrl,
    };
  }
  return {
    activeEnvironment: sanitizeBoxNowEnvironment(settings.activeEnvironment || "stage"),
    environments: envs,
  };
}

function forceBoxNowStageForLocal(settings = {}, req = null) {
  if (!req || !isLocalRequest(req)) {
    return {
      ...settings,
      localEnvironmentForced: false,
      savedActiveEnvironment: settings.activeEnvironment || "stage",
    };
  }
  return {
    ...settings,
    activeEnvironment: "stage",
    savedActiveEnvironment: settings.activeEnvironment || "stage",
    localEnvironmentForced: true,
  };
}

async function getBoxNowSettings({ includeSecrets = false } = {}) {
  const defaults = defaultBoxNowSettings();
  const snap = await db.doc(BOXNOW_SETTINGS_DOC).get();
  const stored = snap.exists ? snap.data() || {} : {};
  const settings = {
    activeEnvironment: sanitizeBoxNowEnvironment(stored.activeEnvironment || defaults.activeEnvironment),
    stage: sanitizeBoxNowEnvConfig(stored.stage || {}, defaults.stage),
    production: sanitizeBoxNowEnvConfig(stored.production || {}, defaults.production),
  };
  return includeSecrets ? settings : publicBoxNowSettings(settings);
}

async function getEffectiveBoxNowSettings(req = null, options = {}) {
  const settings = await getBoxNowSettings(options);
  if (options.forceLocalEnvironment === false) {
    return {
      ...settings,
      localEnvironmentForced: false,
      savedActiveEnvironment: settings.activeEnvironment || "stage",
    };
  }
  return forceBoxNowStageForLocal(settings, req);
}

async function saveBoxNowSettings(input = {}, adminUser = {}) {
  const existing = await getBoxNowSettings({ includeSecrets: true });
  const activeEnvironment = sanitizeBoxNowEnvironment(input.activeEnvironment || existing.activeEnvironment);
  const settings = {
    activeEnvironment,
    stage: sanitizeBoxNowEnvConfig(input.stage || {}, existing.stage),
    production: sanitizeBoxNowEnvConfig(input.production || {}, existing.production),
    updatedAt: now(),
    updatedBy: adminUser.uid || "",
  };
  await db.doc(BOXNOW_SETTINGS_DOC).set(settings, { merge: true });
  return publicBoxNowSettings(settings);
}

function boxNowEnvConfig(settings, env) {
  const environment = settings.localEnvironmentForced === true
    ? "stage"
    : sanitizeBoxNowEnvironment(env || settings.activeEnvironment);
  const config = settings[environment] || {};
  const info = BOXNOW_ENVIRONMENTS[environment];
  return { environment, ...info, ...config };
}

function parseBoxNowResponseBody(text, contentType = "") {
  if (contentType.includes("application/json")) {
    try {
      return text ? JSON.parse(text) : null;
    } catch {
      return { raw: text };
    }
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

async function boxNowApiRequest(config, path, options = {}) {
  const baseUrl = options.locationApi ? config.locationBaseUrl : config.apiBaseUrl;
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const url = path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`;
  const headers = { ...(options.headers || {}) };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  const resp = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body,
  });
  const contentType = resp.headers.get("content-type") || "";
  if (options.raw) {
    const buffer = Buffer.from(await resp.arrayBuffer());
    return { ok: resp.ok, status: resp.status, contentType, buffer };
  }
  const text = await resp.text();
  return {
    ok: resp.ok,
    status: resp.status,
    contentType,
    data: parseBoxNowResponseBody(text, contentType),
  };
}

async function getBoxNowAccessToken(config) {
  if (!config.clientId || !config.clientSecret) {
    throw new Error(`BOX NOW ${config.environment} client ID/secret are not configured`);
  }
  const authBodies = [
    {
      label: "client_credentials_with_grant_type",
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    },
  ];
  const failures = [];

  for (const body of authBodies) {
    const { label, ...requestBody } = body;
    const response = await boxNowApiRequest(config, "/api/v1/auth-sessions", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(requestBody),
    });
    if (!response.ok) {
      failures.push({ label, status: response.status, data: response.data || {} });
      continue;
    }
    const token =
      response.data?.access_token ||
      response.data?.accessToken ||
      response.data?.token ||
      response.data?.data?.access_token ||
      response.data?.data?.accessToken ||
      response.data?.data?.token;
    if (token) {
      return {
        token,
        tokenType: response.data?.token_type || response.data?.tokenType || "Bearer",
        expiresIn: Number(response.data?.expires_in || response.data?.expiresIn || 0),
      };
    }
    failures.push({
      label,
      status: response.status,
      data: { error: "Auth response did not include an access token", response: response.data },
    });
  }

  throw new Error(
    `BOX NOW auth failed for ${config.environment} at ${config.apiBaseUrl} ` +
    `${JSON.stringify(failures)}`
  );
}

function compactBoxNowResult(result) {
  if (!result) return result;
  const compact = {
    ok: result.ok,
    status: result.status,
    contentType: result.contentType || "",
  };
  if (result.data != null) compact.data = result.data;
  if (result.buffer) {
    compact.size = result.buffer.length;
    compact.base64 = result.buffer.toString("base64");
  }
  return compact;
}

function boxNowParcelItemsForOrder(order, productsMap = PRODUCTS_MAP) {
  const cartItems = (Array.isArray(order.items) ? order.items : []).map(item => ({
    id: item.id,
    qty: Math.max(1, Number(item.quantity || item.qty || 1)),
  }));
  const parcel = calculateBoxNowParcel(cartItems, productsMap);
  const parcelSizes = Array.isArray(parcel.parcels) && parcel.parcels.length ? parcel.parcels : [parcel];
  const subtotal = Math.max(0, Number(order.amountSubtotal || orderItemsSubtotal(order)));
  const valuePerParcel = parcelSizes.length ? subtotal / parcelSizes.length / 100 : 0;
  const weightPerParcel = parcelSizes.length ? Math.max(1, Math.round(Number(parcel.weightGrams || order.boxnowFee?.weightGrams || 0) / parcelSizes.length)) : 0;
  return parcelSizes.map((size, index) => ({
    id: `${publicOrderId(order)}-${index + 1}`,
    name: `${publicOrderId(order)} parcel ${index + 1}`,
    value: valuePerParcel.toFixed(2),
    weight: weightPerParcel,
    compartmentSize: Number(size.code || parcel.code || 2),
  }));
}

function buildBoxNowDeliveryRequest(order, config, productsMap = PRODUCTS_MAP) {
  const orderNumber = publicOrderId(order);
  const shipping = order.shipping || {};
  const boxNow = shipping.boxNow || {};
  if (!orderNumber) throw new Error("Order is missing an order number");
  if (!boxNow.id) throw new Error("Order is missing a BOX NOW locker ID");
  if (!config.originLocationId) throw new Error(`Set the ${config.environment} BOX NOW origin location ID first`);
  if (!config.originContactNumber) throw new Error(`Set the ${config.environment} BOX NOW origin contact phone first`);

  const customer = order.customer || {};
  const destinationPhone = shipping.phone || customer.phone || "";
  const destinationEmail = customer.email || "";
  if (!destinationPhone) throw new Error("Order is missing the recipient phone number");
  if (!destinationEmail) throw new Error("Order is missing the recipient email");

  const isCod = order.paymentMethod === "cash_on_delivery" || shipping.cashOnDelivery === true;
  const totalCents = Math.max(0, Number(order.amountDue || order.amountTotal || 0));
  return {
    orderNumber,
    invoiceValue: (Math.max(0, Number(order.amountSubtotal || 0)) / 100).toFixed(2),
    paymentMode: isCod ? "cod" : "prepaid",
    amountToBeCollected: isCod ? (totalCents / 100).toFixed(2) : "0.00",
    origin: {
      contactNumber: config.originContactNumber,
      contactEmail: config.originContactEmail || GRUBZ_INFO_EMAIL,
      contactName: config.originContactName || "GRUBZ",
      locationId: String(config.originLocationId),
    },
    destination: {
      contactNumber: destinationPhone,
      contactEmail: destinationEmail,
      contactName: customer.name || shipping.name || "GRUBZ Customer",
      locationId: String(boxNow.id),
    },
    items: boxNowParcelItemsForOrder(order, productsMap),
  };
}

async function createBoxNowDeliveryForOrder(orderId, options = {}, adminUser = {}) {
  const orderRef = db.collection("orders").doc(orderId);
  const orderSnap = await orderRef.get();
  if (!orderSnap.exists) throw new Error("Order not found");
  const order = { id: orderSnap.id, ...orderSnap.data() };
  if (order.boxNowShipment?.deliveryRequestId && !options.force) {
    throw new Error("This order already has a BOX NOW delivery request");
  }

  const settings = await getEffectiveBoxNowSettings(options.req || null, { includeSecrets: true });
  const config = boxNowEnvConfig(settings, options.environment || settings.activeEnvironment);
  const productsMap = await getProductsMap({ includeInactive: true });
  const payload = buildBoxNowDeliveryRequest(order, config, productsMap);
  const { token } = await getBoxNowAccessToken(config);
  const response = await boxNowApiRequest(config, "/api/v1/delivery-requests", {
    method: "POST",
    token,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`BOX NOW delivery request failed (${response.status}): ${JSON.stringify(response.data || {})}`);
  }

  const parcels = Array.isArray(response.data?.parcels) ? response.data.parcels : [];
  const parcelIds = parcels.map(parcel => String(parcel.id || parcel.parcelId || "")).filter(Boolean);
  const deliveryRequestId = String(response.data?.id || response.data?.deliveryRequestId || publicOrderId(order));
  const firstParcelId = parcelIds[0] || "";
  const update = {
    boxNowShipment: {
      environment: config.environment,
      deliveryRequestId,
      parcelIds,
      status: "new",
      paymentMode: payload.paymentMode,
      amountToBeCollected: payload.amountToBeCollected,
      request: payload,
      response: response.data || {},
      createdAt: now(),
      createdBy: adminUser.uid || "",
    },
    shipping: {
      ...(order.shipping || {}),
      trackingNumber: firstParcelId || order.shipping?.trackingNumber || "",
      trackingUrl: order.shipping?.trackingUrl || "",
    },
    updatedAt: now(),
    updatedBy: adminUser.uid || "",
  };
  await orderRef.set(update, { merge: true });
  return { orderId, environment: config.environment, request: payload, response: response.data, parcelIds, deliveryRequestId };
}

function normalizeCartItems(items, productsMap = PRODUCTS_MAP) {
  return (Array.isArray(items) ? items : []).map(({ id, qty }) => {
    const p = productsMap[id];
    if (!p) throw new Error(`Unknown product id: ${id}`);
    return { id, qty: Math.max(1, Math.round(Number(qty || 0))), product: p };
  });
}

function cartWeightGrams(items, productsMap = PRODUCTS_MAP) {
  return normalizeCartItems(items, productsMap).reduce((sum, item) => {
    return sum + (Number(item.product.weightGrams || 0) * item.qty);
  }, 0);
}

function fallbackParcelHeightCm(product = {}) {
  const weightGrams = Math.max(0, Number(product.weightGrams || 0));
  if (!weightGrams) return 2;
  return Math.max(2, Math.ceil((weightGrams / 1000) * 8));
}

function productParcelDimensions(product = {}) {
  const parcel = product.parcel || {};
  return {
    heightCm: Number(parcel.heightCm || 0) || fallbackParcelHeightCm(product),
    widthCm: Number(parcel.widthCm || 0) || 45,
    lengthCm: Number(parcel.lengthCm || 0) || 60,
  };
}

function expandParcelItems(items, productsMap = PRODUCTS_MAP) {
  return normalizeCartItems(items, productsMap).flatMap(({ id, qty, product }) => {
    const dimensions = productParcelDimensions(product);
    return Array.from({ length: qty }, () => ({
      id,
      heightCm: dimensions.heightCm,
      widthCm: dimensions.widthCm,
      lengthCm: dimensions.lengthCm,
    }));
  });
}

function canPackParcelItems(itemHeights, parcelSizes) {
  const remaining = parcelSizes
    .map(size => Number(size.heightCm || 0))
    .sort((a, b) => b - a);
  const heights = [...itemHeights].sort((a, b) => b - a);

  function place(index) {
    if (index >= heights.length) return true;
    const height = heights[index];
    let previousRemaining = -1;
    for (let i = 0; i < remaining.length; i += 1) {
      if (remaining[i] < height || remaining[i] === previousRemaining) continue;
      remaining[i] -= height;
      if (place(index + 1)) return true;
      remaining[i] += height;
      previousRemaining = remaining[i];
      if (remaining[i] === height) break;
    }
    return false;
  }

  return place(0);
}

function parcelCombinationLabel(parcels) {
  const counts = parcels.reduce((acc, parcel) => {
    acc[parcel.label] = (acc[parcel.label] || 0) + 1;
    return acc;
  }, {});
  return ["Small", "Medium", "Large"]
    .filter(label => counts[label])
    .map(label => counts[label] > 1 ? `${counts[label]}x ${label}` : label)
    .join(" + ");
}

function cheapestParcelCombination(itemHeights) {
  if (!itemHeights.length) return [];
  const totalHeightCm = itemHeights.reduce((sum, height) => sum + height, 0);
  const maxSmall = Math.ceil(totalHeightCm / BOXNOW_PARCEL_SIZES[0].heightCm) + 1;
  const maxMedium = Math.ceil(totalHeightCm / BOXNOW_PARCEL_SIZES[1].heightCm) + 1;
  const maxLarge = Math.ceil(totalHeightCm / BOXNOW_PARCEL_SIZES[2].heightCm) + 1;
  let best = null;

  for (let small = 0; small <= maxSmall; small += 1) {
    for (let medium = 0; medium <= maxMedium; medium += 1) {
      for (let large = 0; large <= maxLarge; large += 1) {
        const parcels = [
          ...Array.from({ length: small }, () => BOXNOW_PARCEL_SIZES[0]),
          ...Array.from({ length: medium }, () => BOXNOW_PARCEL_SIZES[1]),
          ...Array.from({ length: large }, () => BOXNOW_PARCEL_SIZES[2]),
        ];
        if (!parcels.length) continue;
        const capacity = parcels.reduce((sum, parcel) => sum + parcel.heightCm, 0);
        if (capacity < totalHeightCm) continue;
        const amount = parcels.reduce((sum, parcel) => sum + parcel.amount, 0);
        const count = parcels.length;
        if (
          best &&
          (amount > best.amount ||
            (amount === best.amount && count > best.count) ||
            (amount === best.amount && count === best.count && capacity >= best.capacity))
        ) {
          continue;
        }
        if (!canPackParcelItems(itemHeights, parcels)) continue;
        best = { parcels, amount, count, capacity };
      }
    }
  }

  return best?.parcels || [BOXNOW_PARCEL_SIZES[BOXNOW_PARCEL_SIZES.length - 1]];
}

function calculateBoxNowParcel(items, productsMap = PRODUCTS_MAP) {
  const parcelItems = expandParcelItems(items, productsMap);
  const totalHeightCm = parcelItems.reduce((sum, item) => sum + item.heightCm, 0);
  const maxWidthCm = parcelItems.reduce((max, item) => Math.max(max, item.widthCm), 0);
  const maxLengthCm = parcelItems.reduce((max, item) => Math.max(max, item.lengthCm), 0);
  const itemHeights = parcelItems.map(item => item.heightCm);
  const parcels = cheapestParcelCombination(itemHeights);
  const largestParcel = parcels.reduce((largest, parcel) => {
    return parcel.heightCm > largest.heightCm ? parcel : largest;
  }, parcels[0] || BOXNOW_PARCEL_SIZES[BOXNOW_PARCEL_SIZES.length - 1]);
  const amount = parcels.reduce((sum, parcel) => sum + parcel.amount, 0);
  const capacityHeightCm = parcels.reduce((sum, parcel) => sum + parcel.heightCm, 0);

  return {
    code: largestParcel.code,
    label: parcelCombinationLabel(parcels) || largestParcel.label,
    amount,
    heightCm: largestParcel.heightCm,
    widthCm: largestParcel.widthCm,
    lengthCm: largestParcel.lengthCm,
    count: parcels.length,
    capacityHeightCm,
    parcels: parcels.map(parcel => ({
      code: parcel.code,
      label: parcel.label,
      amount: parcel.amount,
      heightCm: parcel.heightCm,
      widthCm: parcel.widthCm,
      lengthCm: parcel.lengthCm,
    })),
    requiredHeightCm: Math.ceil(totalHeightCm * 10) / 10,
    maxItemWidthCm: Math.ceil(maxWidthCm * 10) / 10,
    maxItemLengthCm: Math.ceil(maxLengthCm * 10) / 10,
    oversized: itemHeights.some(height => height > largestParcel.heightCm) ||
      maxWidthCm > largestParcel.widthCm ||
      maxLengthCm > largestParcel.lengthCm,
  };
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

async function calculateBoxNowFee(items, shipping, productsMap = PRODUCTS_MAP) {
  const weightGrams = cartWeightGrams(items, productsMap);
  const parcel = calculateBoxNowParcel(items, productsMap);
  const shippingSettings = await getShippingSettings();
  if (shippingSettings.boxnowFeeOverrideEnabled) {
    return {
      amount: shippingSettings.boxnowFeeOverrideCents,
      currency: "eur",
      source: "admin-override",
      weightGrams,
      parcel,
    };
  }

  return {
    amount: parcel.amount,
    currency: "eur",
    source: "boxnow-parcel-size",
    weightGrams,
    parcel,
  };
}

function sanitizeShippingSettings(input = {}) {
  const overrideEnabled = input.boxnowFeeOverrideEnabled === true;
  const rawCents = input.boxnowFeeOverrideCents ?? input.boxnowFeeOverrideAmountCents ?? null;
  const amount = rawCents === "" || rawCents == null ? 0 : Math.round(Number(rawCents));
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid BOX NOW override amount");
  return {
    boxnowFeeOverrideEnabled: overrideEnabled,
    boxnowFeeOverrideCents: amount,
    updatedAt: now(),
  };
}

async function getShippingSettings() {
  const snap = await db.doc(SHIPPING_SETTINGS_DOC).get();
  if (!snap.exists) {
    return { boxnowFeeOverrideEnabled: false, boxnowFeeOverrideCents: 0 };
  }
  const data = snap.data() || {};
  return {
    boxnowFeeOverrideEnabled: data.boxnowFeeOverrideEnabled === true,
    boxnowFeeOverrideCents: Math.max(0, Math.round(Number(data.boxnowFeeOverrideCents || 0))),
  };
}

exports.getBoxNowFee = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    secrets: [
      BOXNOW_CLIENT_ID,
      BOXNOW_CLIENT_SECRET,
      BOXNOW_PARTNER_ID,
    ],
    cors: ALLOWED_ORIGIN_LIST,
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

      const productsMap = await getProductsMap();
      const fee = await calculateBoxNowFee(items, shipping, productsMap);
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
    invoker: "public",
    secrets: [
      ...STRIPE_SECRETS,
      BOXNOW_CLIENT_ID,
      BOXNOW_CLIENT_SECRET,
      BOXNOW_PARTNER_ID,
      SMTP_USER,
      SMTP_PASS,
      ORDER_NOTIFICATION_EMAIL,
      ORDER_NOTIFICATION_FROM,
    ],
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });

      const authUser = await authUserFromBearer(req);
      const uid = authUser?.uid || null; // may be null for card checkout (guest allowed)

      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const items = Array.isArray(body.items) ? body.items : [];
      const couponCode = normalizeCouponCode(body.couponCode || body.code || "");
      const shipping = body.shipping && typeof body.shipping === "object" ? body.shipping : null;
      const boxNow = shipping && shipping.boxNow && typeof shipping.boxNow === "object" ? shipping.boxNow : null;
      const cashOnDelivery = shipping?.cashOnDelivery === true;

      if (!items.length) return res.status(400).json({ error: "No items" });
      if (!String(boxNow?.id || "").trim()) {
        return res.status(400).json({ error: "Missing BOX NOW locker" });
      }
      const productsMap = await getProductsMap();

      if (cashOnDelivery) {
        if (!uid) return res.status(401).json({ error: "Sign in is required for cash on delivery" });
        const stripeConfig = await activeStripeConfig(req);
        const order = await createCashOnDeliveryOrder({
          uid,
          email: authUser?.email || "",
          items,
          shipping: { ...shipping, cashOnDelivery: true },
          couponCode,
          productsMap,
          stripeMode: stripeConfig.mode,
        });
        await sendOrderNotificationOnce("cash_on_delivery_order", order, { id: order.id, type: "cash_on_delivery" });
        await sendCustomerSuccessEmailOnce(order, { id: order.id, type: "cash_on_delivery" });
        return res.status(200).json({
          ok: true,
          cashOnDelivery: true,
          orderNumber: order.orderNumber,
          url: `/checkout/success?cod=1&order=${encodeURIComponent(order.orderNumber)}`,
        });
      }

      const stripeConfig = await activeStripeConfig(req);

      const line_items = items.map(({ id, qty }) => {
        const p = productsMap[id];
        if (!p) throw new Error(`Unknown product id: ${id}`);
        if (p.active === false) throw new Error(`Inactive product id: ${id}`);
        const quantity = Math.max(1, Number(qty || 0));
        const stripeRefs = stripeRefsForProduct(p, stripeConfig.mode);
        if (stripeRefs.priceId) return { price: stripeRefs.priceId, quantity };
        if (stripeConfig.mode === "live") {
          throw new Error(`Missing live Stripe price for ${p.name || id}. Add a production price ID in the console.`);
        }
        return {
          quantity,
          price_data: {
            currency: p.currency || "eur",
            unit_amount: Number(p.amount),
            product_data: { name: p.name || id },
          },
        };
      });

      const boxNowFee = await calculateBoxNowFee(items, shipping, productsMap);
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

      const stripe = stripeConfig.stripe;
      const orderNumber = generateOrderNumber();
      const couponResult = couponCode
        ? await evaluateCoupon({
          code: couponCode,
          items,
          productsMap,
          uid: uid || "",
          email: authUser?.email || "",
          stripeMode: stripeConfig.mode,
        })
        : null;
      const promotionCodeId = couponResult
        ? await ensureStripePromotionCodeForCoupon(couponResult.coupon, stripeConfig.mode, couponResult.orderItems, stripeConfig)
        : null;
      const checkoutMetadata = {
        orderNumber,
        uid: uid || "guest",
        stripeMode: stripeConfig.mode,
        paymentMethod: "card",
        cart: JSON.stringify(items).slice(0, 5000),
        deliveryMethod: shipping?.deliveryMethod || "boxnow",
        shippingName: String(shipping?.name || "").slice(0, 500),
        shippingPhone: String(shipping?.phone || "").slice(0, 500),
        cashOnDelivery: shipping?.cashOnDelivery === true ? "true" : "false",
        boxnowLockerId: String(boxNow?.id || "").slice(0, 500),
        boxnowLockerName: String(boxNow?.name || "").slice(0, 500),
        boxnowLockerPostalCode: String(boxNow?.postalCode || "").slice(0, 500),
        boxnowLockerAddressLine1: String(boxNow?.addressLine1 || "").slice(0, 500),
        boxnowLockerAddressLine2: String(boxNow?.addressLine2 || "").slice(0, 500),
        boxnowLockerLat: String(boxNow?.lat || "").slice(0, 500),
        boxnowLockerLng: String(boxNow?.lng || "").slice(0, 500),
        boxnowFeeAmount: String(boxNowFee.amount || 0).slice(0, 500),
        boxnowFeeCurrency: String(boxNowFee.currency || "eur").slice(0, 500),
        boxnowFeeSource: String(boxNowFee.source || "").slice(0, 500),
        boxnowWeightGrams: String(boxNowFee.weightGrams || 0).slice(0, 500),
        boxnowParcelSize: String(boxNowFee.parcel?.code || "").slice(0, 500),
        boxnowParcelLabel: String(boxNowFee.parcel?.label || "").slice(0, 500),
        boxnowParcelCount: String(boxNowFee.parcel?.count || 0).slice(0, 500),
        boxnowRequiredHeightCm: String(boxNowFee.parcel?.requiredHeightCm || 0).slice(0, 500),
        couponCode: couponResult?.coupon?.code || "",
        couponId: couponResult?.coupon?.id || "",
        couponDiscountCents: String(couponResult?.discountCents || 0).slice(0, 500),
      };

      const params = {
        mode: "payment",
        client_reference_id: orderNumber,
        line_items,
        automatic_tax: { enabled: false },
        success_url: `${HOSTING_BASE}/checkout/success?sid={CHECKOUT_SESSION_ID}`,
        cancel_url: `${HOSTING_BASE}/checkout/cancelled`,
        metadata: checkoutMetadata,
        payment_intent_data: { metadata: checkoutMetadata },
      };

      if (promotionCodeId) {
        params.discounts = [{ promotion_code: promotionCodeId }];
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
  {
    region: "europe-west1",
    invoker: "public",
    secrets: [
      ...STRIPE_SECRETS,
      SMTP_USER,
      SMTP_PASS,
      ORDER_NOTIFICATION_EMAIL,
      ORDER_NOTIFICATION_FROM,
    ],
  },
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    if (!sig) return res.status(400).send("Missing webhook signature");

    let event;
    try {
      const active = await effectiveStripeSettings(req);
      const modes = active.mode === "live" ? ["live", "test"] : ["test", "live"];
      let lastError = null;
      for (const mode of modes) {
        const secret = stripeSecretForMode(mode);
        const whSecret = stripeWebhookSecretForMode(mode);
        if (!secret || !whSecret) continue;
        try {
          const stripe = stripeClient(secret);
          event = stripe.webhooks.constructEvent(req.rawBody, sig, whSecret);
          break;
        } catch (err) {
          lastError = err;
        }
      }
      if (!event) throw lastError || new Error("Missing webhook secret");
    } catch (e) {
      return res.status(400).send(`Webhook signature verification failed: ${e.message}`);
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          const order = await upsertOrderFromSession(session);
          await sendOrderNotificationOnce("purchase_complete", order, event);
          await sendCustomerSuccessEmailOnce(order, event);
          break;
        }
        case "checkout.session.async_payment_succeeded": {
          const session = event.data.object;
          const order = await upsertOrderFromSession(session);
          await sendOrderNotificationOnce("purchase_complete", order, event);
          await sendCustomerSuccessEmailOnce(order, event);
          break;
        }
        case "checkout.session.async_payment_failed": {
          const session = event.data.object;
          const order = await upsertOrderFromSession(session);
          order.status = "payment_failed";
          order.paymentStatus = "failed";
          await db.collection("orders").doc(order.id).set({
            status: order.status,
            paymentStatus: order.paymentStatus,
            updatedAt: now(),
          }, { merge: true });
          await sendOrderNotificationOnce("purchase_failed", order, event);
          break;
        }
        case "payment_intent.payment_failed": {
          const intent = event.data.object;
          const order = await upsertOrderFromPaymentIntent(intent);
          await sendOrderNotificationOnce("purchase_failed", order, event);
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

// ===== Public products (Firestore-backed, seeded from legacy catalog) =====
exports.getProducts = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method !== "GET") return jsonError(res, 405, "Use GET");
      const productsMap = await getProductsMap();
      const products = Object.entries(productsMap)
        .map(([id, product]) => productToPublic(id, product))
        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name));
      return res.json({ products });
    } catch (e) {
      logger.error("getProducts failed", e);
      return jsonError(res, 500, "products_unavailable");
    }
  }
);

// ===== Admin console APIs =====
exports.adminProducts = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    secrets: STRIPE_SECRETS,
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      const adminUser = await requireAdmin(req);

      if (req.method === "GET") {
        const productsMap = await getProductsMap({ includeInactive: true });
        const products = Object.entries(productsMap)
          .map(([id, product]) => productToPublic(id, product))
          .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0) || a.name.localeCompare(b.name));
        return res.json({ products });
      }

      if (req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const product = sanitizeProductPayload(body.product || body);
        const ref = db.collection("products").doc(product.id);
        const existing = await ref.get();
        await ref.set(
          {
            ...product,
            createdAt: existing.exists ? existing.data().createdAt || now() : now(),
            updatedBy: adminUser.uid,
          },
          { merge: true }
        );

        const stripeConfig = await activeStripeConfig(req, { forceLocalEnvironment: false });
        const activeStripeRefs = stripeRefsForProduct(product, stripeConfig.mode);
        if (activeStripeRefs.productId && product.stock != null) {
          try {
            await stripeConfig.stripe.products.update(activeStripeRefs.productId, {
              metadata: { stock: String(product.stock) },
            });
          } catch (err) {
            logger.warn("Failed to sync product stock to Stripe", err);
          }
        }

        return res.json({ ok: true, product });
      }

      if (req.method === "DELETE") {
        const id = String(req.query.id || "").trim();
        if (!id) return jsonError(res, 400, "Missing product id");
        await db.collection("products").doc(id).delete();
        return res.json({ ok: true });
      }

      return jsonError(res, 405, "Use GET, POST, or DELETE");
    } catch (err) {
      return adminError(res, err);
    }
  }
);

exports.adminProductImage = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method !== "POST") return jsonError(res, 405, "Use POST");
      const adminUser = await requireAdmin(req);
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const { id, contentType, buffer, ext } = parseImageUpload(body);

      const bucket = getStorage().bucket();
      const token = randomUUID();
      const filePath = `product-images/${id}-${Date.now()}.${ext}`;
      const file = bucket.file(filePath);
      await file.save(buffer, {
        metadata: {
          contentType,
          cacheControl: "public, max-age=31536000",
          metadata: { firebaseStorageDownloadTokens: token },
        },
        resumable: false,
      });

      const image = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(filePath)}?alt=media&token=${token}`;
      await db.collection("products").doc(id).set({
        image,
        updatedAt: now(),
        updatedBy: adminUser.uid,
      }, { merge: true });

      return res.json({ ok: true, image, path: filePath });
    } catch (err) {
      return adminError(res, err);
    }
  }
);

exports.adminCoupons = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      const adminUser = await requireAdmin(req);

      if (req.method === "GET") {
        const snap = await db.collection(COUPONS_COLLECTION).orderBy("code").limit(250).get();
        const coupons = snap.docs.map(doc => couponToPublic(doc.id, doc.data()));
        return res.json({ coupons });
      }

      if (req.method === "POST" || req.method === "PATCH") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const input = body.coupon || body;
        const previousId = String(body.id || input.id || "").trim();
        const previousSnap = previousId ? await db.collection(COUPONS_COLLECTION).doc(previousId).get() : null;
        const existing = previousSnap?.exists ? previousSnap.data() : {};
        const coupon = sanitizeCouponPayload(input, existing);
        const id = couponDocId(coupon.code);
        const ref = db.collection(COUPONS_COLLECTION).doc(id);
        const currentSnap = await ref.get();
        await ref.set({
          ...coupon,
          createdAt: currentSnap.exists ? currentSnap.data().createdAt || existing.createdAt || now() : existing.createdAt || now(),
          updatedBy: adminUser.uid,
        }, { merge: true });
        if (previousId && previousId !== id) {
          await db.collection(COUPONS_COLLECTION).doc(previousId).delete();
        }
        return res.json({ ok: true, coupon: couponToPublic(id, coupon) });
      }

      if (req.method === "DELETE") {
        const id = String(req.query.id || "").trim();
        if (!id) return jsonError(res, 400, "Missing coupon id");
        await db.collection(COUPONS_COLLECTION).doc(id).delete();
        return res.json({ ok: true });
      }

      return jsonError(res, 405, "Use GET, POST, PATCH, or DELETE");
    } catch (err) {
      return adminError(res, err);
    }
  }
);

exports.adminOrders = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    secrets: [
      SMTP_USER,
      SMTP_PASS,
      ORDER_NOTIFICATION_FROM,
    ],
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      const adminUser = await requireAdmin(req);

      if (req.method === "GET") {
        const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
        const snap = await db.collection("orders").orderBy("createdAt", "desc").limit(limit).get();
        const orders = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ orders });
      }

      if (req.method === "PATCH" || req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const id = String(body.id || "").trim();
        if (!id) return jsonError(res, 400, "Missing order id");

        const orderRef = db.collection("orders").doc(id);
        const existingSnap = await orderRef.get();
        const existingOrder = existingSnap.exists ? { id, ...existingSnap.data() } : { id };
        const previousFulfillmentStatus = String(existingOrder.fulfillmentStatus || "");
        const allowed = {};
        if (body.status != null) allowed.status = String(body.status).trim();
        if (body.fulfillmentStatus != null) allowed.fulfillmentStatus = String(body.fulfillmentStatus).trim();
        if (body.notes != null) allowed.notes = String(body.notes).slice(0, 5000);
        if (body.shipping && typeof body.shipping === "object") {
          allowed.shipping = body.shipping;
        }
        if (body.trackingNumber != null || body.trackingUrl != null) {
          allowed.shipping = {
            ...(allowed.shipping || {}),
            trackingNumber: String(body.trackingNumber || "").trim(),
            trackingUrl: String(body.trackingUrl || "").trim(),
          };
        }
        allowed.updatedAt = now();
        allowed.updatedBy = adminUser.uid;

        await orderRef.set(allowed, { merge: true });

        let statusEmail = { skipped: true, reason: "fulfillment_not_updated" };
        if (
          allowed.fulfillmentStatus != null &&
          normalizeOrderStatus(allowed.fulfillmentStatus) !== normalizeOrderStatus(previousFulfillmentStatus)
        ) {
          if (body.sendFulfillmentEmail === true) {
            const mergedShipping = {
              ...(existingOrder.shipping || {}),
              ...(allowed.shipping || {}),
            };
            const updatedOrder = {
              ...existingOrder,
              ...allowed,
              id,
              shipping: mergedShipping,
            };
            try {
              statusEmail = await sendOrderStatusEmailOnce(updatedOrder, previousFulfillmentStatus);
            } catch (err) {
              logger.error("Order fulfillment email failed", {
                orderId: id,
                fulfillmentStatus: allowed.fulfillmentStatus,
                error: err.message || "Email failed",
              });
              statusEmail = { failed: true, error: err.message || "Email failed" };
            }
          } else {
            statusEmail = { skipped: true, reason: "email_not_requested" };
          }
        }

        return res.json({ ok: true, statusEmail });
      }

      return jsonError(res, 405, "Use GET or PATCH");
    } catch (err) {
      return adminError(res, err);
    }
  }
);

exports.adminCustomers = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      const adminUser = await requireAdmin(req);

      if (req.method === "GET") {
        const limit = Math.min(500, Math.max(1, Number(req.query.limit || 250)));
        const orderLimit = Math.min(1000, Math.max(limit, Number(req.query.orderLimit || 500)));
        const customersByKey = new Map();
        const customersByEmail = new Map();

        const usersSnap = await db.collection("users").orderBy("createdAt", "desc").limit(limit).get();
        for (const doc of usersSnap.docs) {
          const customer = publicCustomerFromDoc(doc);
          customersByKey.set(customer.key, customer);
          if (customer.email) customersByEmail.set(String(customer.email).toLowerCase(), customer);
        }

        const ordersSnap = await db.collection("orders").orderBy("createdAt", "desc").limit(orderLimit).get();
        for (const doc of ordersSnap.docs) {
          const order = { id: doc.id, ...doc.data() };
          const orderKey = customerKeyForOrder(order);
          if (!orderKey) continue;
          const email = String(order.customer?.email || "").trim().toLowerCase();
          const existingByEmail = email ? customersByEmail.get(email) : null;
          const customer = existingByEmail || customersByKey.get(orderKey) || {
            key: orderKey,
            uid: orderKey.startsWith("uid:") ? orderKey.slice(4) : "",
            email,
            name: "",
            phone: "",
            shipping: null,
            notes: "",
            tags: [],
            createdAt: null,
            updatedAt: null,
            orderCount: 0,
            totalSpent: 0,
            currency: order.currency || "eur",
            lastOrderAt: null,
            lastOrderAtMs: 0,
            recentOrders: [],
          };
          mergeCustomerOrder(customer, order);
          customer.recentOrders.sort((a, b) => millisFromTimestamp(b.createdAt) - millisFromTimestamp(a.createdAt));
          customer.recentOrders = customer.recentOrders.slice(0, 8);
          customersByKey.set(customer.key, customer);
          if (customer.email) customersByEmail.set(String(customer.email).toLowerCase(), customer);
        }

        const customers = [...customersByKey.values()]
          .map(customer => {
            const { lastOrderAtMs, ...publicCustomer } = customer;
            return publicCustomer;
          })
          .sort((a, b) => {
            const lastOrderDiff = millisFromTimestamp(b.lastOrderAt) - millisFromTimestamp(a.lastOrderAt);
            if (lastOrderDiff) return lastOrderDiff;
            return String(a.email || a.name || a.uid).localeCompare(String(b.email || b.name || b.uid));
          });

        return res.json({ customers });
      }

      if (req.method === "PATCH" || req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const uid = String(body.uid || "").trim();
        if (!uid || uid === "guest") return jsonError(res, 400, "Choose a registered customer.");
        const notes = body.notes == null ? null : String(body.notes).slice(0, 5000);
        const tags = Array.isArray(body.tags)
          ? body.tags.map(tag => String(tag || "").trim()).filter(Boolean).slice(0, 20)
          : null;
        const update = {
          updatedAt: now(),
          updatedBy: adminUser.uid,
        };
        if (notes != null) update.notes = notes;
        if (tags) update.tags = tags;
        await db.collection("users").doc(uid).set(update, { merge: true });
        return res.json({ ok: true });
      }

      return jsonError(res, 405, "Use GET or PATCH");
    } catch (err) {
      return adminError(res, err);
    }
  }
);

exports.chat = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      const authUser = await authUserFromBearer(req);

      if (req.method === "GET") {
        const conversationId = String(req.query.conversationId || "").trim();
        const guestId = String(req.query.guestId || "").trim();
        if (!conversationId) return jsonError(res, 400, "Missing conversation ID");
        const ref = db.collection(CHAT_CONVERSATIONS_COLLECTION).doc(conversationId);
        const snap = await ref.get();
        if (!snap.exists) return jsonError(res, 404, "Conversation not found");
        const customer = chatCustomerFromRequest({ guestId }, authUser);
        if (!canAccessChatConversation(snap.data() || {}, customer)) return jsonError(res, 403, "Forbidden");
        await ref.set({ unreadCustomer: 0, customerLastReadAt: now(), updatedAt: now() }, { merge: true });
        const updatedSnap = await ref.get();
        const messages = await chatMessagesForConversation(conversationId);
        return res.json({ conversation: publicChatConversation(updatedSnap.id, updatedSnap.data()), messages });
      }

      if (req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const text = sanitizeChatText(body.message || body.text || "");
        if (!text) return jsonError(res, 400, "Message is required");
        const customer = chatCustomerFromRequest(body, authUser);
        if (!customer.uid && !customer.guestId) return jsonError(res, 400, "Missing guest ID");
        const requestedId = String(body.conversationId || "").trim();
        const ref = requestedId
          ? db.collection(CHAT_CONVERSATIONS_COLLECTION).doc(requestedId)
          : db.collection(CHAT_CONVERSATIONS_COLLECTION).doc();
        const snap = await ref.get();
        if (snap.exists && !canAccessChatConversation(snap.data() || {}, customer)) {
          return jsonError(res, 403, "Forbidden");
        }
        const messageRef = ref.collection("messages").doc();
        const mergedCustomer = mergeChatCustomer(snap.exists ? snap.data()?.customer || {} : {}, customer);
        const conversation = {
          status: snap.exists ? snap.data()?.status || "open" : "open",
          customer: mergedCustomer,
          lastMessageText: text,
          lastMessageAt: now(),
          unreadAdmin: FieldValue.increment(1),
          unreadCustomer: snap.exists ? snap.data()?.unreadCustomer || 0 : 0,
          createdAt: snap.exists ? snap.data()?.createdAt || now() : now(),
          updatedAt: now(),
        };
        await ref.set(conversation, { merge: true });
        await messageRef.set({
          conversationId: ref.id,
          sender: "customer",
          senderName: mergedCustomer.name || mergedCustomer.email || "Customer",
          text,
          createdAt: now(),
          createdBy: customer.uid || customer.guestId,
        });
        const updatedSnap = await ref.get();
        const messages = await chatMessagesForConversation(ref.id);
        return res.json({ ok: true, conversation: publicChatConversation(ref.id, updatedSnap.data()), messages });
      }

      return jsonError(res, 405, "Use GET or POST");
    } catch (err) {
      logger.error("Chat request failed", { error: err.message || "Chat failed" });
      return jsonError(res, Number(err.status || 400), err.message || "Chat failed");
    }
  }
);

exports.adminChat = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      const adminUser = await requireAdmin(req);

      if (req.method === "GET") {
        const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
        let snap;
        try {
          snap = await db.collection(CHAT_CONVERSATIONS_COLLECTION)
            .orderBy("lastMessageAt", "desc")
            .limit(limit)
            .get();
        } catch {
          snap = await db.collection(CHAT_CONVERSATIONS_COLLECTION).limit(limit).get();
        }
        const conversations = snap.docs.map(doc => publicChatConversation(doc.id, doc.data()));
        const selectedId = String(req.query.conversationId || "").trim();
        let messages = [];
        if (selectedId) {
          messages = await chatMessagesForConversation(selectedId, 200);
          await db.collection(CHAT_CONVERSATIONS_COLLECTION).doc(selectedId).set({
            unreadAdmin: 0,
            adminLastReadAt: now(),
            updatedAt: now(),
          }, { merge: true });
        }
        return res.json({
          conversations: conversations.sort((a, b) => {
            const aSeconds = a.lastMessageAt?._seconds || a.lastMessageAt?.seconds || 0;
            const bSeconds = b.lastMessageAt?._seconds || b.lastMessageAt?.seconds || 0;
            return bSeconds - aSeconds;
          }),
          messages,
        });
      }

      if (req.method === "POST" || req.method === "PATCH") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const conversationId = String(body.conversationId || body.id || "").trim();
        if (!conversationId) return jsonError(res, 400, "Missing conversation ID");
        const ref = db.collection(CHAT_CONVERSATIONS_COLLECTION).doc(conversationId);
        const snap = await ref.get();
        if (!snap.exists) return jsonError(res, 404, "Conversation not found");

        const status = body.status == null ? "" : String(body.status || "").trim();
        const text = sanitizeChatText(body.message || body.text || "");
        const update = {
          unreadAdmin: 0,
          adminLastReadAt: now(),
          updatedAt: now(),
          updatedBy: adminUser.uid,
        };
        if (status) update.status = ["open", "closed"].includes(status) ? status : "open";
        if (text) {
          const messageRef = ref.collection("messages").doc();
          await messageRef.set({
            conversationId,
            sender: "admin",
            senderName: "GRUBZ",
            text,
            createdAt: now(),
            createdBy: adminUser.uid,
          });
          update.lastMessageText = text;
          update.lastMessageAt = now();
          update.unreadCustomer = FieldValue.increment(1);
        }
        await ref.set(update, { merge: true });
        const updatedSnap = await ref.get();
        const messages = await chatMessagesForConversation(conversationId, 200);
        return res.json({ ok: true, conversation: publicChatConversation(conversationId, updatedSnap.data()), messages });
      }

      return jsonError(res, 405, "Use GET or POST");
    } catch (err) {
      return adminError(res, err);
    }
  }
);

exports.adminSocialAgent = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      const adminUser = await requireAdmin(req);

      if (req.method === "GET") {
        const settings = await getSocialAgentSettings();
        const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
        const snap = await db.collection(SOCIAL_OPPORTUNITIES_COLLECTION)
          .orderBy("scannedAt", "desc")
          .limit(limit)
          .get();
        const opportunities = snap.docs.map(doc => publicSocialOpportunity(doc.id, doc.data()));
        return res.json({ settings, opportunities });
      }

      if (req.method === "PATCH") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const previous = await getSocialAgentSettings();
        const settings = sanitizeSocialAgentSettings(body.settings || body, previous);
        await db.doc(SOCIAL_AGENT_SETTINGS_DOC).set({
          ...settings,
          updatedAt: now(),
          updatedBy: adminUser.uid,
        }, { merge: true });
        return res.json({ ok: true, settings });
      }

      if (req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const action = String(body.action || "scan").trim();
        if (action === "scan") {
          const settings = await getSocialAgentSettings();
          const result = await scanSocialAgent(settings, adminUser);
          const snap = await db.collection(SOCIAL_OPPORTUNITIES_COLLECTION)
            .orderBy("scannedAt", "desc")
            .limit(50)
            .get();
          const opportunities = snap.docs.map(doc => publicSocialOpportunity(doc.id, doc.data()));
          return res.json({ ok: true, settings, opportunities, scan: result });
        }
        if (action === "importManual") {
          const settings = await getSocialAgentSettings();
          const imported = await importManualSocialItems(body.items || [], settings, adminUser);
          const snap = await db.collection(SOCIAL_OPPORTUNITIES_COLLECTION)
            .orderBy("scannedAt", "desc")
            .limit(50)
            .get();
          const opportunities = snap.docs.map(doc => publicSocialOpportunity(doc.id, doc.data()));
          return res.json({ ok: true, settings, opportunities, imported });
        }
        if (action === "updateOpportunity") {
          const id = String(body.id || "").trim();
          if (!id) return jsonError(res, 400, "Missing opportunity id");
          const status = String(body.status || "new").trim();
          const allowedStatuses = new Set(["new", "approved", "posted", "skipped"]);
          if (!allowedStatuses.has(status)) return jsonError(res, 400, "Invalid status");
          const update = {
            status,
            notes: String(body.notes || "").slice(0, 2000),
            updatedAt: now(),
            updatedBy: adminUser.uid,
          };
          await db.collection(SOCIAL_OPPORTUNITIES_COLLECTION).doc(id).set(update, { merge: true });
          return res.json({ ok: true });
        }
        return jsonError(res, 400, "Unknown Social Agent action");
      }

      return jsonError(res, 405, "Use GET, PATCH, or POST");
    } catch (err) {
      return adminError(res, err);
    }
  }
);

exports.socialAgentWebhook = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    secrets: [SOCIAL_AGENT_WEBHOOK_SECRET],
    cors: true,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method !== "POST") return jsonError(res, 405, "Use POST");
      const expectedSecret = secretValue(SOCIAL_AGENT_WEBHOOK_SECRET, "");
      if (!expectedSecret) return jsonError(res, 503, "Social Agent webhook secret is not configured");

      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
      const providedSecret = String(req.headers["x-grubz-social-secret"] || bearer || body.secret || "").trim();
      if (!safeStringEqual(providedSecret, expectedSecret)) {
        return jsonError(res, 401, "Invalid webhook secret");
      }

      const items = socialWebhookItems(body);
      if (!items.length) return jsonError(res, 400, "No social posts found in webhook payload");

      const settings = await getSocialAgentSettings();
      const imported = await importManualSocialItems(items, settings, { uid: "social-agent-webhook" });
      return res.json({ ok: true, importedCount: imported.length, imported });
    } catch (err) {
      logger.error("Social Agent webhook failed", { error: err.message || "Webhook failed" });
      return jsonError(res, Number(err.status || 400), err.message || "Social Agent webhook failed");
    }
  }
);

exports.adminSettings = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    secrets: [
      BOXNOW_CLIENT_ID,
      BOXNOW_CLIENT_SECRET,
      BOXNOW_PARTNER_ID,
      SMTP_USER,
      SMTP_PASS,
      ORDER_NOTIFICATION_FROM,
    ],
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      const adminUser = await requireAdmin(req);

      if (req.method === "GET") {
        const shipping = await getShippingSettings();
        const stripe = await effectiveStripeSettings(req, { forceLocalEnvironment: false });
        const orderEmails = await getOrderEmailSettings();
        const boxNow = await getEffectiveBoxNowSettings(req, { forceLocalEnvironment: false });
        return res.json({ shipping, stripe, orderEmails, boxNow });
      }

      if (req.method === "PATCH" || req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        if (body.action === "sendOrderStatusTestEmail") {
          const result = await sendOrderStatusTestEmail(body.template || {}, adminUser);
          return res.json({ ok: true, result });
        }

        let shipping = null;
        let stripe = null;
        let orderEmails = null;
        let boxNow = null;

        if (body.shipping || body.boxnowFeeOverrideEnabled != null || body.boxnowFeeOverrideCents != null) {
          shipping = sanitizeShippingSettings(body.shipping || body);
          await db.doc(SHIPPING_SETTINGS_DOC).set(
            {
              ...shipping,
              updatedBy: adminUser.uid,
            },
            { merge: true }
          );
        }

        if (body.stripe || body.stripeMode != null) {
          stripe = sanitizeStripeSettings(body.stripe || body);
          await db.doc(STRIPE_SETTINGS_DOC).set(
            {
              ...stripe,
              updatedBy: adminUser.uid,
            },
            { merge: true }
          );
        }

        if (body.orderEmails || Array.isArray(body.orderEmailTemplates)) {
          orderEmails = sanitizeOrderEmailSettings(body.orderEmails || { templates: body.orderEmailTemplates });
          await db.doc(ORDER_EMAIL_SETTINGS_DOC).set(
            {
              ...orderEmails,
              updatedBy: adminUser.uid,
            },
            { merge: true }
          );
        }

        if (body.boxNow) {
          boxNow = await saveBoxNowSettings(body.boxNow, adminUser);
        }

        if (!shipping) shipping = await getShippingSettings();
        if (!stripe) stripe = await effectiveStripeSettings(req, { forceLocalEnvironment: false });
        if (!orderEmails) orderEmails = await getOrderEmailSettings();
        if (!boxNow) boxNow = await getEffectiveBoxNowSettings(req, { forceLocalEnvironment: false });
        return res.json({ ok: true, shipping, stripe, orderEmails, boxNow });
      }

      return jsonError(res, 405, "Use GET or PATCH");
    } catch (err) {
      return adminError(res, err);
    }
  }
);

async function adminBoxNowAction(body = {}, adminUser = {}, req = null) {
  const action = String(body.action || "").trim();
  const settings = await getEffectiveBoxNowSettings(req, { includeSecrets: true, forceLocalEnvironment: false });
  const config = boxNowEnvConfig(settings, body.environment || settings.activeEnvironment);
  const safeEnvironment = config.environment;

  if (action === "createOrderDelivery") {
    const orderId = String(body.orderId || "").trim();
    if (!orderId) throw new Error("Missing order ID");
    return {
      ok: true,
      action,
      environment: safeEnvironment,
      result: await createBoxNowDeliveryForOrder(orderId, {
        environment: safeEnvironment,
        force: body.force === true,
        req,
      }, adminUser),
    };
  }

  if (action === "buildOrderDeliveryPayload") {
    const orderId = String(body.orderId || "").trim();
    if (!orderId) throw new Error("Missing order ID");
    const snap = await db.collection("orders").doc(orderId).get();
    if (!snap.exists) throw new Error("Order not found");
    const productsMap = await getProductsMap({ includeInactive: true });
    return {
      ok: true,
      action,
      environment: safeEnvironment,
      result: buildBoxNowDeliveryRequest({ id: snap.id, ...snap.data() }, config, productsMap),
    };
  }

  if (action === "verifyWebhookSample") {
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    const verified = verifyBoxNowWebhookPayload(JSON.stringify(payload), payload, config.webhookSecret);
    return { ok: true, action, environment: safeEnvironment, result: verified };
  }

  const tokenInfo = await getBoxNowAccessToken(config);
  const token = tokenInfo.token;

  if (action === "testAuth") {
    return {
      ok: true,
      action,
      environment: safeEnvironment,
      result: {
        tokenType: tokenInfo.tokenType,
        expiresIn: tokenInfo.expiresIn,
        tokenMasked: maskedSecret(token),
        clientIdMasked: maskedSecret(config.clientId),
        partnerIdMasked: maskedSecret(config.partnerId),
        partnerIdSet: Boolean(config.partnerId),
        apiBaseUrl: config.apiBaseUrl,
      },
    };
  }

  if (action === "listOrigins") {
    const response = await boxNowApiRequest(config, "/origins", {
      locationApi: true,
      token,
      headers: { accept: "application/json" },
    });
    return { ok: response.ok, action, environment: safeEnvironment, result: compactBoxNowResult(response) };
  }

  if (action === "listDestinations") {
    const params = new URLSearchParams();
    if (body.latlng) params.set("latlng", String(body.latlng).trim());
    if (body.radius) params.set("radius", String(body.radius).trim());
    if (body.requiredSize) params.set("requiredSize", String(body.requiredSize).trim());
    if (body.locationType) params.set("locationType", String(body.locationType).trim());
    const path = `/destinations${params.toString() ? `?${params}` : ""}`;
    const response = await boxNowApiRequest(config, path, {
      locationApi: true,
      token,
      headers: { accept: "application/json" },
    });
    return { ok: response.ok, action, environment: safeEnvironment, result: compactBoxNowResult(response) };
  }

  if (action === "checkAddressDelivery") {
    const response = await boxNowApiRequest(config, "/api/v2/delivery-requests:checkAddressDelivery", {
      method: "POST",
      token,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body.payload || {}),
    });
    return { ok: response.ok, action, environment: safeEnvironment, result: compactBoxNowResult(response) };
  }

  if (action === "fetchParcelLabel" || action === "fetchOrderLabel") {
    const type = String(body.type || "pdf").trim().toLowerCase() === "zpl" ? "zpl" : "pdf";
    const id = String(body.parcelId || body.orderNumber || "").trim();
    if (!id) throw new Error("Enter a parcel ID or order number");
    const path = action === "fetchOrderLabel"
      ? `/api/v1/delivery-requests/${encodeURIComponent(id)}/label.${type}`
      : `/api/v1/parcels/${encodeURIComponent(id)}/label.${type}`;
    const response = await boxNowApiRequest(config, path, {
      raw: true,
      token,
      headers: { accept: type === "pdf" ? "application/pdf" : "text/plain" },
    });
    return { ok: response.ok, action, environment: safeEnvironment, result: compactBoxNowResult(response) };
  }

  if (action === "cancelParcel") {
    const parcelId = String(body.parcelId || "").trim();
    if (!parcelId) throw new Error("Enter a parcel ID");
    const response = await boxNowApiRequest(config, `/api/v1/parcels/${encodeURIComponent(parcelId)}:cancel`, {
      method: "POST",
      token,
      headers: { accept: "application/json" },
    });
    return { ok: response.ok, action, environment: safeEnvironment, result: compactBoxNowResult(response) };
  }

  throw new Error("Unknown BOX NOW action");
}

exports.adminBoxNow = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    secrets: [
      BOXNOW_CLIENT_ID,
      BOXNOW_CLIENT_SECRET,
      BOXNOW_PARTNER_ID,
    ],
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method !== "POST") return jsonError(res, 405, "Use POST");
      const adminUser = await requireAdmin(req);
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const result = await adminBoxNowAction(body, adminUser, req);
      return res.json(result);
    } catch (err) {
      return adminError(res, err);
    }
  }
);

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
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
    } else if (ch === opener) {
      depth += 1;
    } else if (ch === closer) {
      depth -= 1;
      if (depth === 0) return text.slice(index, i + 1);
    }
  }
  return "";
}

function safeTimingEqual(a, b) {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function safeStringEqual(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function hmacHex(value, secret) {
  return createHmac("sha256", secret).update(value).digest("hex");
}

function verifyBoxNowWebhookPayload(rawBody, payload, webhookSecret) {
  const signature = String(payload?.datasignature || payload?.dataSignature || "").trim();
  if (!signature) return { verified: false, skipped: true, reason: "missing_datasignature" };
  if (!webhookSecret) return { verified: false, skipped: true, reason: "missing_webhook_secret" };
  const rawData = extractRawJsonProperty(rawBody, "data");
  const candidates = [rawData, payload?.data ? JSON.stringify(payload.data) : ""].filter(Boolean);
  for (const candidate of candidates) {
    const digest = hmacHex(candidate, webhookSecret);
    if (safeTimingEqual(digest, signature)) return { verified: true, digest };
  }
  return { verified: false, reason: "signature_mismatch" };
}

function boxNowTrackingUpdateFromEvent(payload = {}, environment = "") {
  const data = payload.data || {};
  const parcelId = String(data.parcelId || data.parcelID || payload.subject || "").trim();
  const event = String(data.event || data.parcelState || "").trim();
  const orderNumber = String(data.orderNumber || data.referenceNumber || "").trim();
  return {
    orderNumber,
    parcelId,
    event,
    parcelState: data.parcelState || "",
    parcelReferenceNumber: data.parcelReferenceNumber || "",
    parcelName: data.parcelName || "",
    customer: data.customer || null,
    eventLocation: data.eventLocation || null,
    eventTime: data.time || payload.time || "",
    environment,
  };
}

exports.boxNowWebhook = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    secrets: [
      BOXNOW_CLIENT_ID,
      BOXNOW_CLIENT_SECRET,
      BOXNOW_PARTNER_ID,
    ],
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") return res.status(405).send("Use POST");
      const payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const settings = await getEffectiveBoxNowSettings(req, { includeSecrets: true });
      const source = String(payload.source || "");
      const environment = source.includes("stage") ? "stage" : settings.activeEnvironment;
      const config = boxNowEnvConfig(settings, environment);
      const verification = verifyBoxNowWebhookPayload(req.rawBody || JSON.stringify(payload), payload, config.webhookSecret);
      if (verification.verified === false && !verification.skipped) {
        return res.status(400).send("Invalid BOX NOW webhook signature");
      }

      const update = boxNowTrackingUpdateFromEvent(payload, config.environment);
      const eventId = String(payload.id || `${update.parcelId}_${update.event}_${update.eventTime}`).replace(/[\/#?[\]]+/g, "_");
      await db.collection("boxNowWebhookEvents").doc(eventId || String(Date.now())).set({
        payload,
        verification,
        parsed: update,
        receivedAt: now(),
      }, { merge: true });

      if (update.orderNumber) {
        const snap = await db.collection("orders").where("orderNumber", "==", update.orderNumber).limit(1).get();
        if (!snap.empty) {
          const orderRef = snap.docs[0].ref;
          await orderRef.set({
            boxNowShipment: {
              lastEvent: update.event,
              lastParcelState: update.parcelState,
              lastParcelId: update.parcelId,
              lastEventAt: update.eventTime,
              lastWebhookAt: now(),
              environment: config.environment,
            },
            shipping: {
              trackingNumber: update.parcelId,
            },
            boxNowWebhookEventIds: FieldValue.arrayUnion(eventId),
            updatedAt: now(),
          }, { merge: true });
        }
      }

      return res.status(200).send("[ok]");
    } catch (err) {
      logger.error("BOX NOW webhook failed", err);
      return res.status(500).send("BOX NOW webhook failed");
    }
  }
);

// ===== Public stock (from Firestore product stock) =====
exports.getStock = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      const result = {};
      const productsMap = await getProductsMap();

      for (const [clientId, product] of Object.entries(productsMap)) {
        result[clientId] = Math.max(0, Number(product.stock || 0));
      }

      res.status(200).json(result);
    } catch (e) {
      logger.error("getStock failed", e);
      res.status(500).json({ error: "stock_unavailable" });
    }
  }
);

// ===== Validate coupon =====
exports.validateCoupon = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
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
      const productsMap = await getProductsMap();
      const authUser = await authUserFromBearer(req);
      const stripeSettings = await effectiveStripeSettings(req);
      const result = await evaluateCoupon({
        code: couponCode,
        items: cartItems,
        productsMap,
        uid: authUser?.uid || "",
        email: authUser?.email || "",
        stripeMode: stripeSettings.mode,
      });

      return res.json({
        ok: true,
        code: result.coupon.code,
        discount: Number((result.discountCents / 100).toFixed(2)),
        discountCents: result.discountCents,
        type: result.coupon.type,
        percentOff: Number(result.coupon.percentOff || 0),
        amountOffCents: Number(result.coupon.amountOffCents || 0),
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
exports.getProfile = onRequest({ region: "europe-west1", invoker: "public" }, (req, res) =>
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
exports.saveShipping = onRequest({ region: "europe-west1", invoker: "public" }, (req, res) =>
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
