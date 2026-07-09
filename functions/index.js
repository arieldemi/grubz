// functions/index.js

const { onRequest } = require("firebase-functions/v2/https");
const { beforeUserCreated } = require("firebase-functions/v2/identity");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const { getStorage } = require("firebase-admin/storage");
const { randomUUID } = require("crypto");
const Stripe = require("stripe");
const cors = require("cors");
const nodemailer = require("nodemailer");

// ----- Secrets -----
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const BOXNOW_CLIENT_ID = defineSecret("BOXNOW_CLIENT_ID");
const BOXNOW_CLIENT_SECRET = defineSecret("BOXNOW_CLIENT_SECRET");
const BOXNOW_PARTNER_ID = defineSecret("BOXNOW_PARTNER_ID");
const SMTP_USER = defineSecret("SMTP_USER");
const SMTP_PASS = defineSecret("SMTP_PASS");
const ORDER_NOTIFICATION_EMAIL = defineSecret("ORDER_NOTIFICATION_EMAIL");
const ORDER_NOTIFICATION_FROM = defineSecret("ORDER_NOTIFICATION_FROM");
const BOXNOW_API_BASE_URL = "https://api-production.boxnow.gr";
const BOXNOW_CONFIGURED_FEE_ENDPOINT = "";
const BOXNOW_FALLBACK_FEE_CENTS = 0;
const SHIPPING_SETTINGS_DOC = "settings/shipping";
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

function productDocToRuntime(id, data = {}) {
  return {
    productId: data.stripeProductId || data.productId || "",
    priceId: data.stripePriceId || data.priceId || "",
    amount: Math.max(0, Number(data.amount || 0)),
    weightGrams: Math.max(0, Number(data.weightGrams || 0)),
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
    stripeProductId: product.productId || "",
    stripePriceId: product.priceId || "",
    stock: Number.isFinite(Number(product.stock)) ? Math.max(0, Number(product.stock)) : null,
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
    stripeProductId: String(input.stripeProductId || input.productId || "").trim(),
    stripePriceId: String(input.stripePriceId || input.priceId || "").trim(),
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
    const quantity = Math.max(1, Number(qty || 0));
    const unitAmount = Math.max(0, Number(product.amount || 0));
    return {
      id,
      name: product.name || id,
      quantity,
      unitAmount,
      currency: product.currency || session.currency || "eur",
      totalAmount: unitAmount * quantity,
      stripeProductId: product.productId || "",
      stripePriceId: product.priceId || "",
      image: product.image || "",
    };
  });
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
  const order = {
    id,
    orderNumber,
    uid: metadata.uid || "guest",
    stripeSessionId: id,
    stripePaymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : "",
    status: session.payment_status === "paid" ? "paid" : (session.status || "open"),
    fulfillmentStatus: "new",
    paymentStatus: session.payment_status || "",
    amountTotal: Number(session.amount_total || 0),
    amountSubtotal: Number(session.amount_subtotal || 0),
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
    },
    metadata,
    createdAt: session.created ? Timestamp.fromMillis(session.created * 1000) : now(),
    updatedAt: now(),
  };

  await db.collection("orders").doc(id).set(order, { merge: true });
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
  const order = {
    id,
    orderNumber,
    uid: metadata.uid || "guest",
    stripeSessionId: metadata.stripeSessionId || "",
    stripePaymentIntentId: intent.id,
    status: "payment_failed",
    fulfillmentStatus: "new",
    paymentStatus: "failed",
    amountTotal: Number(intent.amount || 0),
    amountSubtotal: Number(intent.amount || 0),
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

function boxNowLines(order) {
  const shipping = order.shipping || {};
  const boxNow = shipping.boxNow || {};
  const fee = order.boxnowFee || {};
  const feeAmount = Number(fee.amount || 0);
  return [
    `Delivery method: ${shipping.deliveryMethod || "boxnow"}`,
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
  const text = [
    greeting,
    "",
    "Thanks for your order. Your payment was successful and we are preparing your GRUBZ delivery.",
    "",
    `Order: ${orderNumber}`,
    `Total: ${total}`,
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
    <p>Thanks for your order. Your payment was successful and we are preparing your GRUBZ delivery.</p>
    <p><strong>Order:</strong> ${escapeHtml(orderNumber)}<br>
    <strong>Total:</strong> ${escapeHtml(total)}</p>
    <h3>BOX NOW locker</h3>
    <p>${boxNowHtml(order)}</p>
    <h3>Items</h3>
    <ul>${htmlItems}</ul>
    <p>We will contact you if anything else is needed.<br>GRUBZ</p>
  `;
  return { subject, text, html };
}

function alreadyExistsError(err) {
  return err?.code === 6 || err?.code === "already-exists" || /already exists/i.test(err?.message || "");
}

function defaultNotificationFrom() {
  const smtpUser = secretValue(SMTP_USER);
  return smtpUser ? `GRUBZ Orders <${smtpUser}>` : DEFAULT_NOTIFICATION_FROM;
}

async function sendEmail({ to, from, subject, text, html }) {
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

  const info = await smtpTransporter.sendMail({
    from,
    to,
    subject,
    text,
    html,
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
  { region: "europe-west1", invoker: "public", secrets: [STRIPE_SECRET_KEY] },
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

      const secret = STRIPE_SECRET_KEY.value();
      const stripe = stripeClient(secret);
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

function normalizeCartItems(items, productsMap = PRODUCTS_MAP) {
  return (Array.isArray(items) ? items : []).map(({ id, qty }) => {
    const p = productsMap[id];
    if (!p) throw new Error(`Unknown product id: ${id}`);
    return { id, qty: Math.max(1, Number(qty || 0)), product: p };
  });
}

function cartWeightGrams(items, productsMap = PRODUCTS_MAP) {
  return normalizeCartItems(items, productsMap).reduce((sum, item) => {
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

async function calculateBoxNowFee(items, shipping, productsMap = PRODUCTS_MAP) {
  const normalized = normalizeCartItems(items, productsMap);
  const weightGrams = cartWeightGrams(items, productsMap);
  const shippingSettings = await getShippingSettings();
  if (shippingSettings.boxnowFeeOverrideEnabled) {
    return {
      amount: shippingSettings.boxnowFeeOverrideCents,
      currency: "eur",
      source: "admin-override",
      weightGrams,
    };
  }

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
      STRIPE_SECRET_KEY,
      BOXNOW_CLIENT_ID,
      BOXNOW_CLIENT_SECRET,
      BOXNOW_PARTNER_ID,
    ],
    cors: ALLOWED_ORIGIN_LIST,
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
      const productsMap = await getProductsMap();

      const line_items = items.map(({ id, qty }) => {
        const p = productsMap[id];
        if (!p) throw new Error(`Unknown product id: ${id}`);
        if (p.active === false) throw new Error(`Inactive product id: ${id}`);
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

      const secret = STRIPE_SECRET_KEY.value();
      const stripe = stripeClient(secret);
      const orderNumber = generateOrderNumber();
      const checkoutMetadata = {
        orderNumber,
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
        boxnowLockerLat: String(boxNow?.lat || "").slice(0, 500),
        boxnowLockerLng: String(boxNow?.lng || "").slice(0, 500),
        boxnowFeeAmount: String(boxNowFee.amount || 0).slice(0, 500),
        boxnowFeeCurrency: String(boxNowFee.currency || "eur").slice(0, 500),
        boxnowFeeSource: String(boxNowFee.source || "").slice(0, 500),
        boxnowWeightGrams: String(boxNowFee.weightGrams || 0).slice(0, 500),
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
  {
    region: "europe-west1",
    invoker: "public",
    secrets: [
      STRIPE_WEBHOOK_SECRET,
      STRIPE_SECRET_KEY,
      SMTP_USER,
      SMTP_PASS,
      ORDER_NOTIFICATION_EMAIL,
      ORDER_NOTIFICATION_FROM,
    ],
  },
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
    secrets: [STRIPE_SECRET_KEY],
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

        if (product.stripeProductId && product.stock != null) {
          try {
            const stripe = stripeClient(STRIPE_SECRET_KEY.value());
            await stripe.products.update(product.stripeProductId, {
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

exports.adminOrders = onRequest(
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
        const snap = await db.collection("orders").orderBy("createdAt", "desc").limit(limit).get();
        const orders = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ orders });
      }

      if (req.method === "PATCH" || req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const id = String(body.id || "").trim();
        if (!id) return jsonError(res, 400, "Missing order id");

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

        await db.collection("orders").doc(id).set(allowed, { merge: true });
        return res.json({ ok: true });
      }

      return jsonError(res, 405, "Use GET or PATCH");
    } catch (err) {
      return adminError(res, err);
    }
  }
);

exports.adminSettings = onRequest(
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
        const shipping = await getShippingSettings();
        return res.json({ shipping });
      }

      if (req.method === "PATCH" || req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const shipping = sanitizeShippingSettings(body.shipping || body);
        await db.doc(SHIPPING_SETTINGS_DOC).set(
          {
            ...shipping,
            updatedBy: adminUser.uid,
          },
          { merge: true }
        );
        return res.json({ ok: true, shipping });
      }

      return jsonError(res, 405, "Use GET or PATCH");
    } catch (err) {
      return adminError(res, err);
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

// ===== Validate coupon (returns promotionCodeId now) =====
exports.validateCoupon = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    secrets: [STRIPE_SECRET_KEY],
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

      // Compute EUR subtotal from Firestore-backed products
      let subtotalEUR = 0;
      for (const { id, qty } of cartItems) {
        const p = productsMap[id];
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
