// functions/index.js

const { onRequest } = require("firebase-functions/v2/https");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { beforeUserCreated, HttpsError } = require("firebase-functions/v2/identity");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { getAuth: getAdminAuth } = require("firebase-admin/auth");
const { getStorage } = require("firebase-admin/storage");
const { randomUUID, createHash, timingSafeEqual } = require("crypto");
const Stripe = require("stripe");
const { sanitizePilot, pilotMetrics } = require("./collaborationPilot");
const OpenAI = require("openai");
const cors = require("cors");
const nodemailer = require("nodemailer");
const { brandBoxNowLabelPdf, composeA4BoxNowLabels, prepareA4BoxNowLabelPdf } = require("./boxNowLabelPdf");
const { verifyBoxNowWebhookPayload } = require("./boxNowWebhookSignature");
const { boxNowFulfillmentForEvent } = require("./boxNowFulfillment");
const { normalizeOrderLanguage, resolveOrderLanguage } = require("./orderLanguage");

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
const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
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
const BOXNOW_STAGE_TEST_DESTINATION_LOCATION_ID = "9";
const BOXNOW_CONFIGURED_FEE_ENDPOINT = "";
const BOXNOW_FALLBACK_FEE_CENTS = 0;
const BOXNOW_PARCEL_SIZES = [
  { code: "1", label: "Small", amount: 300, heightCm: 8, widthCm: 45, lengthCm: 60, capacityKg: 0 },
  { code: "2", label: "Medium", amount: 500, heightCm: 17, widthCm: 45, lengthCm: 60, capacityKg: 10 },
  { code: "3", label: "Large", amount: 1000, heightCm: 36, widthCm: 45, lengthCm: 60, capacityKg: 20 },
];
const ONE_KG_FLEXIBLE_BAG_PARCEL = { heightCm: 16 / 3, widthCm: 30, lengthCm: 28 };
const BOXNOW_FLATTENED_BAGS_PER_COMPARTMENT = 10;
const BOXNOW_MIN_FLATTENED_BAG_COMPARTMENT_HEIGHT_CM = 17;
const HAPPY_CHICKEN_PACKED_PARCELS = {
  "happy-chicken-1kg": ONE_KG_FLEXIBLE_BAG_PARCEL,
  "happy-chicken-2kg": { heightCm: 14, widthCm: 24, lengthCm: 41 },
  "happy-chicken-3kg": { heightCm: 16, widthCm: 30, lengthCm: 28 },
};
const SHIPPING_SETTINGS_DOC = "settings/shipping";
const STRIPE_SETTINGS_DOC = "settings/stripe";
const ORDER_EMAIL_SETTINGS_DOC = "settings/orderEmails";
const BOXNOW_SETTINGS_DOC = "settings/boxnow";
const SOCIAL_AGENT_SETTINGS_DOC = "settings/socialAgent";
const CHATBOT_SETTINGS_DOC = "settings/chatbot";
const MARKETING_SETTINGS_DOC = "settings/marketing";
const COUPONS_COLLECTION = "coupons";
const EMAIL_RESERVATIONS_COLLECTION = "emailReservations";
const SOCIAL_OPPORTUNITIES_COLLECTION = "socialOpportunities";
const SOCIAL_GROUPS_COLLECTION = "socialGroups";
const SOCIAL_POSTS_COLLECTION = "socialPosts";
const COLLABORATIONS_COLLECTION = "collaborations";
const CHAT_CONVERSATIONS_COLLECTION = "chatConversations";
const MARKETING_LEADS_COLLECTION = "marketingLeads";
const ABANDONED_CARTS_COLLECTION = "abandonedCarts";
const NEWSLETTER_SUBSCRIBERS_COLLECTION = "newsletterSubscribers";
const NEWSLETTER_SENDS_COLLECTION = "newsletterSends";
const NEWSLETTER_IDEAS_COLLECTION = "newsletterIdeas";
const ORDER_FEEDBACK_COLLECTION = "orderFeedback";
const FEEDBACK_CUSTOMERS_COLLECTION = "feedbackCustomers";
const SCHEDULED_ORDER_EMAILS_COLLECTION = "scheduledOrderEmails";
const FEEDBACK_LINK_LIFETIME_DAYS = 30;
const FEEDBACK_COUPON_LIFETIME_DAYS = 90;
const GRUBZ_SIGNATURE_IMAGE_URL = "https://grubz.gr/images/grubz-email-signature.png";
const GRUBZ_INFO_EMAIL = "info@grubz.gr";
const GRUBZ_URL = "https://grubz.gr";
const BULK_CUSTOMER_EMAIL_TEST_MODE = false;
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
    body: "{greeting}\n\nWe received your GRUBZ order {orderNumber} and it is now in our queue.\n\nTotal: {total}\n\nGRUBZ",
    translations: {
      el: {
        subject: "Λάβαμε την παραγγελία GRUBZ {orderNumber}",
        body: "{greeting}\n\nΛάβαμε την παραγγελία σου {orderNumber} και είναι πλέον στη σειρά μας.\n\nΣύνολο: {total}\n\nGRUBZ",
      },
    },
  },
  {
    enabled: true,
    fulfillmentStatus: "processing",
    subject: "Your GRUBZ order {orderNumber} is being prepared",
    body: "{greeting}\n\nYour GRUBZ order {orderNumber} is now being prepared.\n\nWe will update you again when it is packed.\n\nGRUBZ",
    translations: {
      el: {
        subject: "Η παραγγελία GRUBZ {orderNumber} ετοιμάζεται",
        body: "{greeting}\n\nΗ παραγγελία σου {orderNumber} ετοιμάζεται.\n\nΘα σε ενημερώσουμε ξανά όταν συσκευαστεί.\n\nGRUBZ",
      },
    },
  },
  {
    enabled: true,
    fulfillmentStatus: "packed",
    subject: "Your GRUBZ order {orderNumber} is packed",
    body: "{greeting}\n\nYour GRUBZ order {orderNumber} has been packed and is almost ready to ship.\n\nGRUBZ",
    translations: {
      el: {
        subject: "Η παραγγελία GRUBZ {orderNumber} συσκευάστηκε",
        body: "{greeting}\n\nΗ παραγγελία σου {orderNumber} έχει συσκευαστεί και είναι σχεδόν έτοιμη για αποστολή.\n\nGRUBZ",
      },
    },
  },
  {
    enabled: true,
    fulfillmentStatus: "shipped",
    subject: "Your GRUBZ order {orderNumber} has shipped",
    body: "{greeting}\n\nYour GRUBZ order {orderNumber} has shipped.\n\nTracking number: {trackingNumber}\nTracking link: {trackingUrl}\n\nGRUBZ",
    translations: {
      el: {
        subject: "Η παραγγελία GRUBZ {orderNumber} στάλθηκε",
        body: "{greeting}\n\nΗ παραγγελία σου {orderNumber} έχει σταλεί.\n\nΑριθμός αποστολής: {trackingNumber}\nΣύνδεσμος παρακολούθησης: {trackingUrl}\n\nGRUBZ",
      },
    },
  },
  {
    enabled: true,
    fulfillmentStatus: "delivered",
    subject: "Your GRUBZ order {orderNumber} was delivered",
    body: "{greeting}\n\nYour GRUBZ order {orderNumber} has been delivered.\n\nThank you for choosing GRUBZ.\n\nGRUBZ",
    translations: {
      el: {
        subject: "Η παραγγελία GRUBZ {orderNumber} παραδόθηκε",
        body: "{greeting}\n\nΗ παραγγελία σου {orderNumber} παραδόθηκε.\n\nΣε ευχαριστούμε που επέλεξες GRUBZ.\n\nGRUBZ",
      },
    },
  },
  {
    enabled: true,
    fulfillmentStatus: "cancelled",
    subject: "Your GRUBZ order {orderNumber} was cancelled",
    body: "{greeting}\n\nYour GRUBZ order {orderNumber} has been cancelled.\n\nIf you have any questions, reply to this email.\n\nGRUBZ",
    translations: {
      el: {
        subject: "Η παραγγελία GRUBZ {orderNumber} ακυρώθηκε",
        body: "{greeting}\n\nΗ παραγγελία σου {orderNumber} ακυρώθηκε.\n\nΑν έχεις ερωτήσεις, απάντησε σε αυτό το email.\n\nGRUBZ",
      },
    },
  },
  {
    enabled: true,
    templateContext: "feedback",
    fulfillmentStatus: "feedback_request",
    subject: "How was your GRUBZ order {orderNumber}?",
    body: "{greeting}\n\nWe hope you are enjoying your GRUBZ order {orderNumber}.\n\nShare your feedback using your personal link below. After you submit the form, we will email you a unique 10% discount code for your next order.\n\n{feedback_url}\n\nThe link can be used once and expires after 30 days.\n\nGRUBZ",
    translations: {
      el: {
        subject: "Πώς σου φάνηκε η παραγγελία GRUBZ {orderNumber};",
        body: "{greeting}\n\nΕλπίζουμε να απολαμβάνεις την παραγγελία σου GRUBZ {orderNumber}.\n\nΜοιράσου τη γνώμη σου μέσω του προσωπικού συνδέσμου παρακάτω. Μετά την υποβολή, θα σου στείλουμε με email έναν μοναδικό κωδικό έκπτωσης 10% για την επόμενη παραγγελία σου.\n\n{feedback_url}\n\nΟ σύνδεσμος χρησιμοποιείται μία φορά και λήγει σε 30 ημέρες.\n\nGRUBZ",
      },
    },
  },
  {
    enabled: true,
    templateContext: "order",
    fulfillmentStatus: "locker_arrival",
    subject: "Your GRUBZ parcel is ready for pickup",
    body: "{greeting}\n\nYour GRUBZ order {orderNumber} has arrived at the BOX NOW locker:\n\n{boxNowLocker}\n\nYou can collect it now using the PIN sent by BOX NOW.\n\nTrack your parcel: {trackingUrl}\n\nGRUBZ",
    translations: {
      el: {
        subject: "Το δέμα GRUBZ είναι έτοιμο για παραλαβή",
        body: "{greeting}\n\nΗ παραγγελία σου GRUBZ {orderNumber} έφτασε στη θυρίδα BOX NOW:\n\n{boxNowLocker}\n\nΜπορείς να την παραλάβεις τώρα χρησιμοποιώντας το PIN που έστειλε η BOX NOW.\n\nΠαρακολούθηση δέματος: {trackingUrl}\n\nGRUBZ",
      },
    },
  },
  {
    enabled: true,
    templateContext: "order",
    fulfillmentStatus: "locker_reminder",
    subject: "Your GRUBZ parcel is waiting at the BOX NOW locker",
    body: "{greeting}\n\nYour GRUBZ order {orderNumber} is waiting for collection at the BOX NOW locker:\n\n{boxNowLocker}\n\nPlease collect it soon to avoid it being returned.\n\nTrack your parcel: {trackingUrl}\n\nGRUBZ",
    translations: {
      el: {
        subject: "Το δέμα GRUBZ σε περιμένει στη θυρίδα BOX NOW",
        body: "{greeting}\n\nΗ παραγγελία σου GRUBZ {orderNumber} σε περιμένει για παραλαβή στη θυρίδα BOX NOW:\n\n{boxNowLocker}\n\nΠαρακαλούμε παρέλαβέ τη σύντομα, ώστε να μην επιστραφεί.\n\nΠαρακολούθηση δέματος: {trackingUrl}\n\nGRUBZ",
      },
    },
  },
  {
    enabled: true,
    fulfillmentStatus: "abandoned_signup",
    subject: "Still thinking about GRUBZ?",
    body: "{greeting}\n\nThanks for signing up for GRUBZ. It looks like you did not complete your order yet.\n\nIf you are ready, you can use coupon code {coupon} at checkout: {grubz_url}\n\nGRUBZ",
    translations: {
      el: {
        subject: "Σκέφτεσαι ακόμα το GRUBZ;",
        body: "{greeting}\n\nΣε ευχαριστούμε που γράφτηκες στο GRUBZ. Φαίνεται ότι δεν ολοκλήρωσες ακόμα την παραγγελία σου.\n\nΑν είσαι έτοιμος/η, μπορείς να χρησιμοποιήσεις τον κωδικό έκπτωσης {coupon} στο checkout: {grubz_url}\n\nGRUBZ",
      },
    },
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
const PRODUCT_IMAGE_BUCKET = "grubz-99b84-product-images";
const ANALYTICS_EVENTS_COLLECTION = "analyticsEvents";
const ANALYTICS_SESSIONS_COLLECTION = "analyticsSessions";
const FIREBASE_STORAGE_BUCKET = "grubz-99b84.firebasestorage.app";
const FIREBASE_STORAGE_BUCKET_FALLBACKS = [
  PRODUCT_IMAGE_BUCKET,
  FIREBASE_STORAGE_BUCKET,
  "grubz-99b84.appspot.com",
];

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

function isLocalResourceUrl(value = "") {
  return /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(String(value || "").trim());
}

function publicImageUrl(value = "") {
  const image = String(value || "").trim();
  return isLocalResourceUrl(image) ? "" : image;
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
    image: publicImageUrl(data.image),
    imageBg: data.imageBg || "#f8f1eb",
    active: data.active !== false,
    allowBackorder: data.allowBackorder === true,
    inventoryPoolId: String(data.inventoryPoolId || "").trim(),
    sortOrder: Number(data.sortOrder || 0),
    stock: Number.isFinite(Number(data.stock)) ? Math.max(0, Number(data.stock)) : null,
  };
}

function productToPublic(id, product) {
  const stripe = product.stripe || {};
  return {
    id,
    active: product.active !== false,
    allowBackorder: product.allowBackorder === true,
    sortOrder: Number(product.sortOrder || 0),
    name: product.name || id,
    nameEl: product.nameEl || product.name || id,
    description: product.description || "",
    descriptionEl: product.descriptionEl || product.description || "",
    detail: product.detail || product.description || "",
    detailEl: product.detailEl || product.detail || product.descriptionEl || "",
    image: publicImageUrl(product.image),
    imageBg: product.imageBg || "#f8f1eb",
    amount: Math.max(0, Number(product.amount || 0)),
    currency: product.currency || "eur",
    weightGrams: Math.max(0, Number(product.weightGrams || 0)),
    inventoryPoolId: String(product.inventoryPoolId || "").trim(),
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

let legacyInventoryPoolsMigrated = false;
async function getProductsMap({ includeInactive = false } = {}) {
  if (!legacyInventoryPoolsMigrated) {
    await migrateLegacyProductInventoryPools();
    legacyInventoryPoolsMigrated = true;
  }
  const snap = await db.collection("products").get();
  const map = {};
  snap.forEach((doc) => {
    const product = productDocToRuntime(doc.id, doc.data());
    if (includeInactive || product.active !== false) map[doc.id] = product;
  });
  const pools = Object.fromEntries((await getInventoryPools()).map(pool => [pool.id, pool]));
  for (const [id, product] of Object.entries(map)) {
    const pool = pools[String(product.inventoryPoolId || "").trim()];
    const weightGrams = Math.max(0, Number(product.weightGrams || 0));
    if (pool?.updatedAt && weightGrams > 0) {
      product.stock = Math.max(0, Math.floor(pool.availableGrams / weightGrams));
      product.allowBackorder = pool.allowBackorder === true;
    }
  }
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

  const product = {
    id,
    active: input.active !== false,
    allowBackorder: input.allowBackorder === true,
    inventoryPoolId: String(input.inventoryPoolId || "").trim(),
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
  if (product.active) {
    const missing = productActivationMissingFields(product);
    if (missing.length) {
      throw new Error(`Cannot activate product. Missing: ${missing.join(", ")}`);
    }
  }
  return product;
}

function productActivationMissingFields(product = {}) {
  const missing = [];
  if (!String(product.name || "").trim()) missing.push("English name");
  if (!String(product.nameEl || "").trim()) missing.push("Greek name");
  if (!String(product.description || "").trim()) missing.push("English description");
  if (!String(product.descriptionEl || "").trim()) missing.push("Greek description");
  if (!String(product.detail || "").trim()) missing.push("English details");
  if (!String(product.detailEl || "").trim()) missing.push("Greek details");
  if (!String(product.image || "").trim()) missing.push("product image");
  if (!(Number(product.amount || 0) > 0)) missing.push("price");
  if (!(Number(product.weightGrams || 0) > 0)) missing.push("weight");
  if (!String(product.inventoryPoolId || "").trim() && (product.stock == null || !Number.isFinite(Number(product.stock)))) missing.push("stock");
  if (!String(product.currency || "").trim()) missing.push("currency");
  if (!String(product.stripe?.live?.productId || "").trim()) missing.push("live Stripe product ID");
  if (!String(product.stripe?.live?.priceId || "").trim()) missing.push("live Stripe price ID");
  return missing;
}

const DEFAULT_INVENTORY_POOLS = {
  "happy-chicken": { id: "happy-chicken", name: "Happy Chicken", material: "Dried larvae" },
  terragrub: { id: "terragrub", name: "TerraGrub", material: "Frass" },
};

function legacyInventoryPoolIdForMigration(id = "") {
  const value = String(id || "").toLowerCase();
  if (value.startsWith("happy-chicken-")) return "happy-chicken";
  if (value.startsWith("terragrub-")) return "terragrub";
  return "";
}

function inventoryRequirements(items = []) {
  const result = {};
  for (const item of Array.isArray(items) ? items : []) {
    const poolId = String(item.inventoryPoolId || "").trim();
    if (!poolId) continue;
    const grams = Math.max(0, Math.round(Number(item.weightGrams || 0) || 0));
    const quantity = Math.max(0, Math.round(Number(item.quantity || item.qty || 0)));
    if (grams && quantity) result[poolId] = (result[poolId] || 0) + grams * quantity;
  }
  return result;
}

function inventoryPoolView(id, data = {}) {
  const onHandGrams = Math.max(0, Math.round(Number(data.onHandGrams || 0)));
  const reservedGrams = Math.max(0, Math.round(Number(data.reservedGrams || 0)));
  return {
    id,
    name: String(data.name || id),
    material: String(data.material || ""),
    active: data.active !== false,
    allowBackorder: data.allowBackorder === true,
    onHandGrams,
    reservedGrams,
    availableGrams: Math.max(0, onHandGrams - reservedGrams),
    backorderedGrams: Math.max(0, reservedGrams - onHandGrams),
    updatedAt: data.updatedAt || null,
  };
}

async function getInventoryPools() {
  const collection = db.collection("inventoryPools");
  let snap = await collection.get();
  if (snap.empty) {
    const batch = db.batch();
    Object.values(DEFAULT_INVENTORY_POOLS).forEach(pool => batch.set(collection.doc(pool.id), { ...pool, active:true, allowBackorder:false, onHandGrams:0, reservedGrams:0, createdAt:now(), updatedAt:now() }));
    await batch.commit();
    snap = await collection.get();
  }
  return snap.docs.map(doc => inventoryPoolView(doc.id, doc.data())).sort((a, b) => a.name.localeCompare(b.name));
}

async function migrateLegacyProductInventoryPools() {
  const snap = await db.collection("products").get();
  const batch = db.batch();
  let count = 0;
  snap.docs.forEach(doc => {
    if (String(doc.data()?.inventoryPoolId || "").trim()) return;
    const poolId = legacyInventoryPoolIdForMigration(doc.id);
    if (!poolId) return;
    batch.set(doc.ref, { inventoryPoolId:poolId, updatedAt:now() }, { merge:true });
    count += 1;
  });
  if (count) await batch.commit();
  return count;
}

async function transitionOrderInventory(orderId, targetState, actor = "system") {
  const orderRef = db.collection("orders").doc(orderId);
  return db.runTransaction(async transaction => {
    const orderSnap = await transaction.get(orderRef);
    if (!orderSnap.exists) return { skipped: true, reason: "order_not_found" };
    const order = orderSnap.data() || {};
    const currentState = String(order.inventoryState || "none");
    if (currentState === targetState) return { skipped: true, reason: "already_applied" };
    if (currentState === "consumed" && targetState !== "consumed") return { skipped: true, reason: "already_consumed" };
    const requirements = inventoryRequirements(order.items || []);
    const poolIds = Object.keys(requirements);
    const poolRefs = poolIds.map(id => db.collection("inventoryPools").doc(id));
    const poolSnaps = [];
    for (const ref of poolRefs) poolSnaps.push(await transaction.get(ref));
    const updates = {};
    poolIds.forEach((poolId, index) => {
      const data = poolSnaps[index].exists ? poolSnaps[index].data() : {};
      let onHandGrams = Math.max(0, Math.round(Number(data.onHandGrams || 0)));
      let reservedGrams = Math.max(0, Math.round(Number(data.reservedGrams || 0)));
      const grams = requirements[poolId];
      if (targetState === "reserved") {
        if (currentState !== "reserved") reservedGrams += grams;
      } else if (targetState === "consumed") {
        if (currentState === "reserved") reservedGrams = Math.max(0, reservedGrams - grams);
        if (currentState !== "consumed") onHandGrams = Math.max(0, onHandGrams - grams);
      } else if (targetState === "released" && currentState === "reserved") {
        reservedGrams = Math.max(0, reservedGrams - grams);
      }
      updates[poolId] = { onHandGrams, reservedGrams };
      transaction.set(poolRefs[index], { onHandGrams, reservedGrams, updatedAt: now() }, { merge: true });
      transaction.set(db.collection("inventoryTransactions").doc(), {
        poolId,
        type: `order_${targetState}`,
        orderId,
        grams,
        previousState: currentState,
        resultingState: targetState,
        createdAt: now(),
        createdBy: actor,
      });
    });
    transaction.set(orderRef, {
      inventoryState: targetState,
      inventoryRequirementsGrams: requirements,
      inventoryUpdatedAt: now(),
      inventoryUpdatedBy: actor,
    }, { merge: true });
    return { ok: true, state: targetState, requirements, pools: updates };
  });
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
  const details = err.details || null;
  console.error("Admin request failed", {
    status,
    message: err.message || "Admin request failed",
    details,
  });
  return jsonError(res, status, err.message || "Admin request failed", details ? { details } : {});
}

function parseImageUpload(body = {}) {
  const id = String(body.productId || body.id || "").trim();
  if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(id)) {
    throw new Error("Missing or invalid product id");
  }

  const dataUrl = String(body.imageDataUrl || "");
  if (!dataUrl) throw new Error("Missing image upload data");
  if (dataUrl.length > 22 * 1024 * 1024) throw new Error("Image upload is too large. Use an image under 15 MB.");
  const match = dataUrl.match(/^data:(image\/(?:png|jpe?g|webp));base64,([\s\S]+)$/i);
  if (!match) throw new Error("Upload a PNG, JPG, or WebP image");

  const contentType = match[1].toLowerCase() === "image/jpg" ? "image/jpeg" : match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new Error("Image file is empty");
  if (!buffer.toString("base64").replace(/=+$/, "").startsWith(base64.replace(/=+$/, "").slice(0, 32))) {
    throw new Error("Image upload data is invalid");
  }
  if (buffer.length > 600 * 1024) {
    throw new Error("Optimized product images must be 600 KB or smaller");
  }

  const ext = contentType === "image/jpeg" ? "jpg" : contentType.split("/")[1];
  return { id, contentType, buffer, ext };
}

async function saveProductImageToStorage({ id, contentType, buffer, ext }) {
  const token = randomUUID();
  const filePath = `product-images/${id}-${Date.now()}.${ext}`;
  let lastError = null;

  for (const bucketName of FIREBASE_STORAGE_BUCKET_FALLBACKS) {
    try {
      const bucket = getStorage().bucket(bucketName);
      const file = bucket.file(filePath);
      await file.save(buffer, {
        metadata: {
          contentType,
          cacheControl: "public, max-age=31536000",
          metadata: { firebaseStorageDownloadTokens: token },
        },
        resumable: false,
      });
      return {
        bucketName: bucket.name,
        path: filePath,
        image: productImageDownloadUrl({ bucketName: bucket.name, filePath, token }),
      };
    } catch (err) {
      lastError = err;
      logger.warn("Product image bucket upload failed", {
        bucketName,
        code: err.code || "",
        message: err.message || "Storage upload failed",
      });
      if (Number(err.code || 0) !== 404) break;
    }
  }

  throw lastError || new Error("Storage upload failed");
}

function productImageDownloadUrl({ bucketName, filePath, token }) {
  const publicPath = String(filePath || "").split("/").map(part => encodeURIComponent(part)).join("/");
  if (bucketName === PRODUCT_IMAGE_BUCKET) {
    return `https://storage.googleapis.com/${bucketName}/${publicPath}`;
  }
  const encodedPath = encodeURIComponent(filePath);
  const emulatorHost = String(process.env.FIREBASE_STORAGE_EMULATOR_HOST || "").trim();
  if (emulatorHost && !process.env.K_SERVICE) {
    const protocol = /^https?:\/\//i.test(emulatorHost) ? "" : "http://";
    return `${protocol}${emulatorHost}/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${token}`;
  }
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${token}`;
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
    const availableStock = Number.isFinite(Number(product.stock)) ? Math.max(0, Number(product.stock)) : null;
    const backorderQuantity = product.allowBackorder === true && availableStock != null
      ? Math.max(0, quantity - availableStock)
      : 0;
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
      weightGrams: Math.max(0, Number(product.weightGrams || 0)),
      inventoryPoolId: String(product.inventoryPoolId || "").trim(),
      backorder: backorderQuantity > 0,
      backorderQuantity,
    };
  });
}

function orderItemsFromCart(items, productsMap, stripeMode = "test", options = {}) {
  const allowInactive = options.allowInactive === true;
  return (Array.isArray(items) ? items : []).map(({ id, qty }) => {
    const product = productsMap[id] || {};
    if (!product.name && !productsMap[id]) throw new Error(`Unknown product id: ${id}`);
    if (product.active === false && !allowInactive) throw new Error(`Inactive product id: ${id}`);
    const stripeRefs = stripeRefsForProduct(product, stripeMode);
    const quantity = Math.max(1, Number(qty || 0));
    const unitAmount = Math.max(0, Number(product.amount || 0));
    const availableStock = Number.isFinite(Number(product.stock)) ? Math.max(0, Number(product.stock)) : null;
    if (availableStock != null && quantity > availableStock && product.allowBackorder !== true) {
      throw new Error(availableStock > 0
        ? `Only ${availableStock} available for ${product.name || id}`
        : `${product.name || id} is out of stock`);
    }
    const backorderQuantity = product.allowBackorder === true && availableStock != null
      ? Math.max(0, quantity - availableStock)
      : 0;
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
      weightGrams: Math.max(0, Number(product.weightGrams || 0)),
      inventoryPoolId: String(product.inventoryPoolId || "").trim(),
      backorder: backorderQuantity > 0,
      backorderQuantity,
    };
  });
}

function sanitizeStripePaymentLink(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Stripe payment link must be a valid URL");
  }
  if (url.protocol !== "https:") throw new Error("Stripe payment link must use https");
  const host = url.hostname.toLowerCase();
  if (!host.endsWith("stripe.com") && host !== "buy.stripe.com") {
    throw new Error("Stripe payment link must be a Stripe URL");
  }
  return url.toString();
}

async function createManualOrderFromAdmin(input = {}, adminUser = {}) {
  const productsMap = await getProductsMap();
  const itemsInput = Array.isArray(input.items) ? input.items : [];
  const items = orderItemsFromCart(itemsInput, productsMap, sanitizeStripeMode(input.stripeMode || "test"));
  if (!items.length) throw new Error("Add at least one product");

  const amountSubtotal = orderItemsSubtotal({ items });
  const amountShipping = Math.max(0, Math.round(Number(input.amountShipping || input.shippingCents || 0)));
  const baseDiscount = Math.max(0, Math.round(Number(input.amountDiscount || input.discountCents || 0)));
  const baseTotal = Math.max(0, amountSubtotal + amountShipping - baseDiscount);
  const hasTotalOverride = input.amountTotalOverride != null || input.totalOverrideCents != null || input.overrideTotalCents != null;
  const overrideTotal = Math.max(0, Math.round(Number(input.amountTotalOverride ?? input.totalOverrideCents ?? input.overrideTotalCents ?? 0)));
  const amountTotal = hasTotalOverride ? overrideTotal : baseTotal;
  const amountDiscount = hasTotalOverride ? Math.max(baseDiscount, amountSubtotal + amountShipping - amountTotal) : baseDiscount;
  const paymentLink = sanitizeStripePaymentLink(input.stripePaymentLink || input.paymentLink || "");
  const orderNumber = String(input.orderNumber || "").trim() || generateOrderNumber();
  const id = `manual_${orderNumber.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${Date.now()}`;
  const customer = input.customer && typeof input.customer === "object" ? input.customer : {};
  const shipping = input.shipping && typeof input.shipping === "object" ? input.shipping : {};

  const order = {
    id,
    orderNumber,
    uid: String(input.uid || "manual").trim() || "manual",
    manual: true,
    source: "admin_console",
    stripeMode: sanitizeStripeMode(input.stripeMode || "test"),
    stripePaymentLink: paymentLink,
    paymentLink,
    paymentMethod: "stripe_payment_link",
    status: String(input.status || "pending_payment").trim() || "pending_payment",
    fulfillmentStatus: String(input.fulfillmentStatus || "new").trim() || "new",
    language: String(input.language || "en").trim().toLowerCase() === "el" ? "el" : "en",
    paymentStatus: String(input.paymentStatus || "pending_payment").trim() || "pending_payment",
    amountTotal,
    amountSubtotal,
    amountShipping,
    amountDiscount,
    amountDue: amountTotal,
    manualPricingOverride: hasTotalOverride,
    currency: String(input.currency || "eur").trim().toLowerCase() || "eur",
    items,
    customer: {
      email: String(customer.email || input.customerEmail || "").trim(),
      name: String(customer.name || input.customerName || "").trim(),
      phone: String(customer.phone || input.customerPhone || "").trim(),
    },
    shipping: {
      deliveryMethod: String(shipping.deliveryMethod || input.deliveryMethod || "boxnow").trim() || "boxnow",
      name: String(shipping.name || customer.name || input.customerName || "").trim(),
      phone: String(shipping.phone || customer.phone || input.customerPhone || "").trim(),
      addressLine1: String(shipping.addressLine1 || shipping.line1 || shipping.address || input.addressLine1 || input.line1 || "").trim(),
      line1: String(shipping.line1 || shipping.addressLine1 || shipping.address || input.line1 || input.addressLine1 || "").trim(),
      addressLine2: String(shipping.addressLine2 || shipping.line2 || input.addressLine2 || input.line2 || "").trim(),
      line2: String(shipping.line2 || shipping.addressLine2 || input.line2 || input.addressLine2 || "").trim(),
      postalCode: String(shipping.postalCode || shipping.postal || shipping.zip || input.postalCode || input.postal || input.zip || "").trim(),
      postal: String(shipping.postal || shipping.postalCode || shipping.zip || input.postal || input.postalCode || input.zip || "").trim(),
      city: String(shipping.city || input.city || "").trim(),
      country: String(shipping.country || input.country || "").trim(),
      cashOnDelivery: false,
      boxNow: {
        id: String(shipping.boxNow?.id || input.boxNowLockerId || "").trim(),
        name: String(shipping.boxNow?.name || input.boxNowLockerName || "").trim(),
        postalCode: String(shipping.boxNow?.postalCode || input.boxNowLockerPostalCode || "").trim(),
        addressLine1: String(shipping.boxNow?.addressLine1 || input.boxNowAddressLine1 || "").trim(),
        addressLine2: String(shipping.boxNow?.addressLine2 || input.boxNowAddressLine2 || "").trim(),
        lat: String(shipping.boxNow?.lat || "").trim(),
        lng: String(shipping.boxNow?.lng || "").trim(),
      },
      trackingNumber: "",
      trackingUrl: "",
    },
    metadata: {
      orderNumber,
      uid: String(input.uid || "manual").trim() || "manual",
      paymentMethod: "stripe_payment_link",
      stripePaymentLink: paymentLink,
      createdBy: adminUser.uid || "",
    },
    notes: String(input.notes || "").slice(0, 5000),
    createdAt: now(),
    updatedAt: now(),
    createdBy: adminUser.uid || "",
    updatedBy: adminUser.uid || "",
  };

  await db.collection("orders").doc(id).set(order, { merge: true });
  return order;
}

function normalizeCouponCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function normalizeReferralCode(value) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "").replace(/[^A-Z0-9_-]/g, "").slice(0, 80);
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

const DEFAULT_CHATBOT_SETTINGS = {
  enabled: false,
  mode: "draft",
  name: "Gina",
  introduceSelf: true,
  model: "gpt-5.6-luna",
  maxHistoryMessages: 20,
  maxOutputTokens: 500,
  businessContext: "GRUBZ is a Greece-based ecommerce business selling dried black soldier fly larvae products for reptiles, chickens, birds, aquarium fish, and pond fish. Be helpful, practical, friendly, and concise. Do not make promises about orders, refunds, payments, or shipping that are not confirmed by system data.",
  scopeRestriction: "Only answer questions related to GRUBZ, GRUBZ products, product suitability, orders, checkout, coupons, payments, shipping, BOX NOW delivery, returns, support, and business policies. If the customer asks about unrelated topics, politely say you can only help with GRUBZ-related questions and ask what they need about GRUBZ.",
  behaviorRules: [
    "Only greet the customer by name when you are introducing yourself. In follow-up replies, do not start with repeated greetings like 'Hi <name>!' or 'Hello <name>!'; answer naturally and directly.",
    `When a customer clearly wants to buy a product or quantity, do not say the GRUBZ team can arrange the order unless there is an actual order, payment, stock, or policy problem. Guide the customer to add the matching pack quantity to the cart at ${GRUBZ_URL}/#products and continue to checkout. Example: for 3kg of a 1kg product, tell them to add 3 x 1kg packs.`,
    "Do not claim you already added items to the customer's cart unless a system action explicitly confirms it. Use wording like 'Add 3 x TerraGrub 1KG to your cart' instead of 'I added it for you'.",
    "Do not repeat the same product, cart, checkout, coupon, shipping, or policy instructions that GRUBZ already gave in the recent conversation unless the customer explicitly asks the same question again, asks for clarification, or says they did not understand.",
    "If the latest customer message is only an acknowledgement or thanks, such as 'thank you', 'thanks', 'ok', 'ευχαριστώ', or 'εντάξει', reply briefly and naturally without restating previous instructions, links, products, or coupon codes.",
    "Write only the customer-facing draft reply. Do not include analysis, labels, or markdown headings.",
    "Be concise, warm, practical, and honest. Do not pressure customers.",
    "Do not claim that an order, refund, payment, coupon, or shipment was changed unless the provided context explicitly says so.",
    "For order-specific information, only use details present in the context. If verification or human action is needed, say the GRUBZ team will check it.",
  ],
  rejectionHandling: "When customers object or reject the product, acknowledge the concern without pressure. Answer with useful facts, suggest a low-risk next step, and offer human help. Common concerns include price, trust, shipping cost, animal acceptance, product safety, and discomfort with insect-based food.",
  escalationRules: [
    "Refund, cancellation, payment, or chargeback requests",
    "Angry or abusive customer messages",
    "Order-specific questions when the customer is not verified",
    "Medical, veterinary, allergy, or safety claims",
    "Uncertainty about product availability, shipping, or policy",
  ],
  translation: {
    enabled: true,
    replyLanguage: "auto",
    languages: ["en", "el"],
  },
  topics: {
    products: true,
    orders: true,
    shipping: true,
    coupons: true,
    translation: true,
    objections: true,
  },
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

function sanitizeChatbotSettings(input = {}, existing = {}) {
  const merged = { ...DEFAULT_CHATBOT_SETTINGS, ...(existing || {}), ...(input || {}) };
  const inputTranslation = input.translation && typeof input.translation === "object" ? input.translation : {};
  const existingTranslation = existing.translation && typeof existing.translation === "object" ? existing.translation : {};
  const translation = { ...DEFAULT_CHATBOT_SETTINGS.translation, ...existingTranslation, ...inputTranslation };
  const inputTopics = input.topics && typeof input.topics === "object" ? input.topics : {};
  const existingTopics = existing.topics && typeof existing.topics === "object" ? existing.topics : {};
  const topics = { ...DEFAULT_CHATBOT_SETTINGS.topics, ...existingTopics, ...inputTopics };
  const mode = ["off", "draft", "auto"].includes(String(merged.mode || "")) ? String(merged.mode) : "draft";
  const behaviorRules = splitLines(Array.isArray(merged.behaviorRules) ? merged.behaviorRules.join("\n") : merged.behaviorRules);
  const replyLanguage = ["auto", "en", "el"].includes(String(translation.replyLanguage || ""))
    ? String(translation.replyLanguage)
    : "auto";
  const languages = splitLines(Array.isArray(translation.languages) ? translation.languages.join("\n") : translation.languages)
    .map(lang => lang.toLowerCase())
    .filter(lang => ["en", "el"].includes(lang));
  return {
    enabled: merged.enabled === true,
    mode,
    name: String(merged.name || DEFAULT_CHATBOT_SETTINGS.name).trim().slice(0, 80) || DEFAULT_CHATBOT_SETTINGS.name,
    introduceSelf: merged.introduceSelf !== false,
    model: String(merged.model || DEFAULT_CHATBOT_SETTINGS.model).trim().slice(0, 80) || DEFAULT_CHATBOT_SETTINGS.model,
    maxHistoryMessages: Math.min(60, Math.max(4, Math.round(Number(merged.maxHistoryMessages || 20)))),
    maxOutputTokens: Math.min(2000, Math.max(100, Math.round(Number(merged.maxOutputTokens || 500)))),
    businessContext: String(merged.businessContext || DEFAULT_CHATBOT_SETTINGS.businessContext).trim().slice(0, 5000),
    scopeRestriction: String(merged.scopeRestriction || DEFAULT_CHATBOT_SETTINGS.scopeRestriction).trim().slice(0, 3000),
    behaviorRules: (behaviorRules.length ? behaviorRules : DEFAULT_CHATBOT_SETTINGS.behaviorRules).slice(0, 80),
    rejectionHandling: String(merged.rejectionHandling || DEFAULT_CHATBOT_SETTINGS.rejectionHandling).trim().slice(0, 3000),
    escalationRules: splitLines(Array.isArray(merged.escalationRules) ? merged.escalationRules.join("\n") : merged.escalationRules)
      .slice(0, 40),
    translation: {
      enabled: translation.enabled !== false,
      replyLanguage,
      languages: languages.length ? languages : DEFAULT_CHATBOT_SETTINGS.translation.languages,
    },
    topics: {
      products: topics.products !== false,
      orders: topics.orders !== false,
      shipping: topics.shipping !== false,
      coupons: topics.coupons !== false,
      translation: topics.translation !== false,
      objections: topics.objections !== false,
    },
    updatedAt: now(),
  };
}

async function getChatbotSettings() {
  const snap = await db.doc(CHATBOT_SETTINGS_DOC).get();
  return sanitizeChatbotSettings({}, snap.exists ? snap.data() : {});
}

function chatbotSettingsPublic(settings = {}) {
  return {
    enabled: settings.enabled === true,
    mode: settings.mode || "draft",
    name: settings.name || DEFAULT_CHATBOT_SETTINGS.name,
    introduceSelf: settings.introduceSelf !== false,
    model: settings.model || DEFAULT_CHATBOT_SETTINGS.model,
    maxHistoryMessages: Number(settings.maxHistoryMessages || DEFAULT_CHATBOT_SETTINGS.maxHistoryMessages),
    maxOutputTokens: Number(settings.maxOutputTokens || DEFAULT_CHATBOT_SETTINGS.maxOutputTokens),
    scopeRestriction: settings.scopeRestriction || DEFAULT_CHATBOT_SETTINGS.scopeRestriction,
    behaviorRules: Array.isArray(settings.behaviorRules) ? settings.behaviorRules : DEFAULT_CHATBOT_SETTINGS.behaviorRules,
    translation: settings.translation || DEFAULT_CHATBOT_SETTINGS.translation,
    topics: settings.topics || DEFAULT_CHATBOT_SETTINGS.topics,
  };
}

function productSummaryForChatbot(id, product = {}) {
  return [
    `Product ID: ${id}`,
    product.name || id,
    product.nameEl && product.nameEl !== product.name ? `Greek name: ${product.nameEl}` : "",
    product.amount ? `Price: ${(Number(product.amount || 0) / 100).toFixed(2)} ${String(product.currency || "eur").toUpperCase()}` : "",
    product.weightGrams ? `Weight: ${product.weightGrams}g` : "",
    product.description ? `Description: ${product.description}` : "",
    product.descriptionEl && product.descriptionEl !== product.description ? `Greek description: ${product.descriptionEl}` : "",
  ].filter(Boolean).join(" | ");
}

async function activeCouponSummariesForChatbot(limit = 20) {
  const snap = await db.collection(COUPONS_COLLECTION).limit(Math.min(40, Math.max(1, Number(limit || 20)))).get();
  return snap.docs
    .map(doc => couponToPublic(doc.id, doc.data()))
    .filter(coupon => coupon.active !== false)
    .slice(0, limit)
    .map(coupon => {
      const discount = coupon.type === "fixed"
        ? `${(Number(coupon.amountOffCents || 0) / 100).toFixed(2)} ${String(coupon.currency || "eur").toUpperCase()} off`
        : `${Number(coupon.percentOff || 0)}% off`;
      return `${coupon.code}: ${discount}${coupon.description ? ` | ${coupon.description}` : ""}`;
    });
}

function shippingSummaryForChatbot(shipping = {}, boxNow = {}) {
  const activeEnvironment = (boxNow.localEnvironmentForced ? boxNow.savedActiveEnvironment : boxNow.activeEnvironment) || "stage";
  const discount = shipping.boxnowFeeDiscountEnabled
    ? `${(Number(shipping.boxnowFeeDiscountCents || 0) / 100).toFixed(2)} EUR discount`
    : "No console shipping discount";
  const override = shipping.boxnowFeeOverrideEnabled
    ? `${(Number(shipping.boxnowFeeOverrideCents || 0) / 100).toFixed(2)} EUR override`
    : "BOX NOW fee is calculated from parcel size";
  const sizes = BOXNOW_PARCEL_SIZES.map(size => `${size.label}: ${size.heightCm}x${size.widthCm}x${size.lengthCm}cm, ${(size.amount / 100).toFixed(2)} EUR`).join("; ");
  return [
    `BOX NOW environment: ${activeEnvironment}`,
    override,
    discount,
    `BOX NOW compartments: ${sizes}`,
    "Packing rule currently used by GRUBZ: flexible 1kg bags can be flattened; up to 10kg can fit in one medium BOX NOW compartment for any product.",
  ].join("\n");
}

function responseTextFromOpenAI(response = {}) {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text.trim();
  const parts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") parts.push(content.text);
      if (typeof content.output_text === "string") parts.push(content.output_text);
    }
  }
  return parts.join("\n").trim();
}

function latestCustomerMessage(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] || {};
    if (message.sender === "customer" && String(message.text || "").trim()) return message;
  }
  return null;
}

function requestedChatReplyLanguage(text = "") {
  const value = String(text || "").toLowerCase();
  if (/(?:reply|answer|write|speak|use|respond)\s+(?:in\s+)?(?:greek|ελληνικά|ελληνικα|ellinika)|(?:στα|σε)\s+ελληνικά|(?:στα|σε)\s+ελληνικα/.test(value)) {
    return "el";
  }
  if (/(?:reply|answer|write|speak|use|respond)\s+(?:in\s+)?(?:english|αγγλικά|αγγλικα|agglika)|(?:στα|σε)\s+αγγλικά|(?:στα|σε)\s+αγγλικα/.test(value)) {
    return "en";
  }
  return "";
}

function detectChatMessageLanguage(text = "") {
  const value = String(text || "");
  const greekCount = (value.match(/[\u0370-\u03FF]/g) || []).length;
  const latinCount = (value.match(/[A-Za-z]/g) || []).length;
  if (greekCount >= 2 && greekCount >= latinCount) return "el";
  if (latinCount >= 2) return "en";
  return "";
}

function chatLanguageName(language = "") {
  return language === "el" ? "Greek" : "English";
}

function chatbotReplyLanguageForMessages(messages = [], settings = {}) {
  const configured = settings.translation?.replyLanguage || "auto";
  if (configured === "el" || configured === "en") return configured;
  const latest = latestCustomerMessage(messages);
  const text = latest?.text || "";
  return requestedChatReplyLanguage(text) || detectChatMessageLanguage(text) || "en";
}

function draftMatchesReplyLanguage(draft = "", replyLanguage = "") {
  const detected = detectChatMessageLanguage(draft);
  if (replyLanguage === "el") return detected === "el";
  if (replyLanguage === "en") return detected === "en" || !detected;
  return true;
}

async function translateChatbotDraft({ client, model, draft, replyLanguage, maxOutputTokens }) {
  if (!replyLanguage || draftMatchesReplyLanguage(draft, replyLanguage)) return draft;
  const response = await client.responses.create({
    model,
    instructions: [
      `Translate the customer support draft to ${chatLanguageName(replyLanguage)}.`,
      "Keep the same meaning, tone, product names, prices, quantities, URLs, and line breaks.",
      "Return only the translated customer-facing reply. Do not add labels, notes, markdown headings, or explanations.",
    ].join("\n"),
    input: draft,
    max_output_tokens: maxOutputTokens,
    store: false,
  });
  return sanitizeChatText(responseTextFromOpenAI(response), 5000) || draft;
}

async function buildChatbotDraftInput({ conversation = {}, messages = [], settings = {}, shipping = {}, boxNow = {}, replyLanguage = "" }) {
  const topics = settings.topics || {};
  const lines = [];
  const customer = conversation.customer || {};
  lines.push(`Customer: ${customer.name || "Unknown"} ${customer.email ? `<${customer.email}>` : ""}`.trim());
  if (customer.uid) lines.push(`Customer UID: ${customer.uid}`);
  if (customer.guestId && !customer.uid) lines.push(`Guest ID: ${customer.guestId}`);

  if (topics.products !== false) {
    const productsMap = await getProductsMap();
    const products = Object.entries(productsMap)
      .sort((a, b) => Number(a[1].sortOrder || 0) - Number(b[1].sortOrder || 0))
      .slice(0, 30)
      .map(([id, product]) => `- ${productSummaryForChatbot(id, product)}`);
    lines.push(`Products:\n${products.length ? products.join("\n") : "No active products loaded."}`);
  }

  if (topics.coupons !== false) {
    const coupons = await activeCouponSummariesForChatbot(20);
    lines.push(`Active coupons:\n${coupons.length ? coupons.map(item => `- ${item}`).join("\n") : "No active coupons loaded."}`);
  }

  if (topics.shipping !== false) {
    lines.push(`Shipping:\n${shippingSummaryForChatbot(shipping, boxNow)}`);
  }

  if (replyLanguage) {
    lines.push(`Required reply language: ${chatLanguageName(replyLanguage)} (${replyLanguage}).`);
  }

  const history = messages.slice(-settings.maxHistoryMessages).map(message => {
    const role = message.sender === "admin" ? "GRUBZ" : "Customer";
    return `${role}: ${message.text || ""}`;
  });
  lines.push(`Recent conversation:\n${history.join("\n")}`);
  return lines.join("\n\n");
}

function chatbotDraftInstructions(settings = {}, options = {}) {
  const translation = settings.translation || {};
  const topics = settings.topics || {};
  const replyLanguage = options.replyLanguage || "";
  return [
    "You are drafting a customer support chat reply for GRUBZ. The reply will be reviewed by a human admin before sending.",
    `Your chatbot name is ${settings.name || DEFAULT_CHATBOT_SETTINGS.name}.`,
    settings.introduceSelf !== false
      ? `When it feels natural, introduce yourself by name as ${settings.name || DEFAULT_CHATBOT_SETTINGS.name}, especially in the first reply of a conversation. Keep the introduction short.`
      : "Do not introduce yourself by name unless the customer asks who they are speaking with.",
    `Scope restriction controlled by console:\n${settings.scopeRestriction || DEFAULT_CHATBOT_SETTINGS.scopeRestriction}`,
    `Behavior rules controlled by console:\n${(settings.behaviorRules || DEFAULT_CHATBOT_SETTINGS.behaviorRules).map(rule => `- ${rule}`).join("\n")}`,
    replyLanguage ? `Required reply language for this draft: ${chatLanguageName(replyLanguage)}. This is mandatory. Do not answer in another language unless the customer's latest message explicitly asks for a different language.` : "",
    topics.translation !== false && translation.enabled !== false
      ? `Translation: ${translation.replyLanguage === "el" ? "reply in Greek" : translation.replyLanguage === "en" ? "reply in English" : "when set to auto, the required reply language is detected from the customer's latest message before drafting"}. If the customer explicitly asks to use a specific language, follow that requested language instead. Greek and English are supported.`
      : "Translation is disabled; reply in the same language as the latest customer message when possible.",
    `Business knowledge controlled by console:\n${settings.businessContext || DEFAULT_CHATBOT_SETTINGS.businessContext}`,
    topics.objections !== false
      ? `Rejection handling controlled by console:\n${settings.rejectionHandling || DEFAULT_CHATBOT_SETTINGS.rejectionHandling}`
      : "",
    `Escalate instead of solving directly when any of these apply:\n${(settings.escalationRules || DEFAULT_CHATBOT_SETTINGS.escalationRules).map(rule => `- ${rule}`).join("\n")}`,
  ].filter(Boolean).join("\n\n");
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

const COLLABORATION_STATUSES = new Set(["lead", "contacted", "negotiating", "trial_sent", "active", "paused", "ended"]);
const COLLABORATION_TYPES = new Set(["free_product", "discount_code", "paid_post", "ambassador", "testimonial", "case_study", "other"]);
const COLLABORATION_CATEGORIES = new Set(["farm", "homestead", "reptile_keeper", "chicken_owner", "facebook_group_admin", "pet_shop", "breeder", "aquarium", "creator", "other"]);

function collaborationLines(value = "", max = 30) {
  return String(value || "").split(/\r?\n/).map(item => item.trim()).filter(Boolean).slice(0, max);
}

function sanitizeSocialLinks(input = {}) {
  const links = input && typeof input === "object" ? input : {};
  return {
    instagram: String(links.instagram || "").trim().slice(0, 300),
    facebook: String(links.facebook || "").trim().slice(0, 300),
    tiktok: String(links.tiktok || "").trim().slice(0, 300),
    youtube: String(links.youtube || "").trim().slice(0, 300),
    website: String(links.website || "").trim().slice(0, 300),
  };
}

function sanitizeCollaborationInput(input = {}, existing = {}) {
  const merged = { ...(existing || {}), ...(input || {}) };
  const status = COLLABORATION_STATUSES.has(String(merged.status || "")) ? String(merged.status) : "lead";
  const type = COLLABORATION_TYPES.has(String(merged.type || "")) ? String(merged.type) : "discount_code";
  const category = COLLABORATION_CATEGORIES.has(String(merged.category || "")) ? String(merged.category) : "creator";
  const score = Math.min(100, Math.max(0, Math.round(Number(merged.score || 0))));
  return {
    name: String(merged.name || "").trim().slice(0, 180),
    contactName: String(merged.contactName || "").trim().slice(0, 180),
    email: normalizedEmail(merged.email || ""),
    phone: String(merged.phone || "").trim().slice(0, 80),
    customerKey: String(merged.customerKey || "").trim().slice(0, 180),
    orderId: String(merged.orderId || "").trim().slice(0, 180),
    facebookGroupId: String(merged.facebookGroupId || "").trim().slice(0, 180),
    category,
    status,
    type,
    score,
    referralCode: normalizeReferralCode(merged.referralCode || merged.referral || ""),
    socialLinks: sanitizeSocialLinks(merged.socialLinks || {}),
    audienceNotes: String(merged.audienceNotes || "").trim().slice(0, 3000),
    offer: {
      products: String(merged.offer?.products || merged.offerProducts || "").trim().slice(0, 1000),
      quantity: String(merged.offer?.quantity || merged.offerQuantity || "").trim().slice(0, 200),
      shippingCovered: merged.offer?.shippingCovered === true || merged.shippingCovered === true,
      commission: String(merged.offer?.commission || merged.offerCommission || "").trim().slice(0, 200),
      couponCode: String(merged.offer?.couponCode || merged.couponCode || "").trim().toUpperCase().slice(0, 80),
      details: String(merged.offer?.details || merged.offerDetails || "").trim().slice(0, 3000),
    },
    commitments: collaborationLines(Array.isArray(merged.commitments) ? merged.commitments.join("\n") : merged.commitments, 30),
    contentLinks: collaborationLines(Array.isArray(merged.contentLinks) ? merged.contentLinks.join("\n") : merged.contentLinks, 50),
    notes: String(merged.notes || "").trim().slice(0, 5000),
    nextFollowUp: String(merged.nextFollowUp || "").trim().slice(0, 40),
    pilot: sanitizePilot(merged.pilot || {}, existing.pilot || {}),
    startedAt: merged.startedAt || existing.startedAt || now(),
  };
}

function publicCollaboration(id, data = {}) {
  return {
    id,
    name: data.name || "",
    contactName: data.contactName || "",
    email: data.email || "",
    phone: data.phone || "",
    customerKey: data.customerKey || "",
    orderId: data.orderId || "",
    facebookGroupId: data.facebookGroupId || "",
    category: data.category || "creator",
    status: data.status || "lead",
    type: data.type || "discount_code",
    score: Number(data.score || 0),
    referralCode: normalizeReferralCode(data.referralCode || data.referral || ""),
    socialLinks: sanitizeSocialLinks(data.socialLinks || {}),
    audienceNotes: data.audienceNotes || "",
    offer: data.offer || {},
    commitments: Array.isArray(data.commitments) ? data.commitments : [],
    contentLinks: Array.isArray(data.contentLinks) ? data.contentLinks : [],
    notes: data.notes || "",
    nextFollowUp: data.nextFollowUp || "",
    pilot: sanitizePilot(data.pilot || {}),
    startedAt: data.startedAt || null,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    updatedBy: data.updatedBy || "",
    metrics: data.metrics || null,
  };
}

function couponCodeForOrder(order = {}) {
  return normalizeCouponCode(
    order.couponCode ||
    order.coupon ||
    order.metadata?.couponCode ||
    order.metadata?.coupon ||
    order.paymentIntent?.metadata?.couponCode ||
    ""
  );
}

function referralCodeForOrder(order = {}) {
  return normalizeReferralCode(
    order.referralCode ||
    order.referral ||
    order.metadata?.referralCode ||
    order.paymentIntent?.metadata?.referralCode ||
    ""
  );
}

function collaborationOrderKey(order = {}, index = 0) {
  return String(order.id || order.orderNumber || order.stripeSessionId || order.stripePaymentIntentId || `order_${index}`);
}

function collaborationMetricsForAttribution({ couponCode = "", referralCode = "" } = {}, orders = []) {
  const coupon = normalizeCouponCode(couponCode || "");
  const referral = normalizeReferralCode(referralCode || "");
  const matchedById = new Map();
  if (coupon) {
    for (let index = 0; index < orders.length; index += 1) {
      const order = orders[index];
      if (couponCodeForOrder(order) === coupon) matchedById.set(collaborationOrderKey(order, index), order);
    }
  }
  if (referral) {
    for (let index = 0; index < orders.length; index += 1) {
      const order = orders[index];
      if (referralCodeForOrder(order) === referral) matchedById.set(collaborationOrderKey(order, index), order);
    }
  }
  const matchedOrders = Array.from(matchedById.values());
  const matchedCustomerKeys = new Set(matchedOrders.map(customerKeyForOrder).filter(Boolean));
  const earliestOrderByCustomer = new Map();
  for (const order of orders) {
    const customerKey = customerKeyForOrder(order);
    if (!customerKey || !matchedCustomerKeys.has(customerKey)) continue;
    const createdMs = millisFromTimestamp(order.createdAt);
    const current = earliestOrderByCustomer.get(customerKey);
    if (!current || createdMs < current.createdMs) earliestOrderByCustomer.set(customerKey, { createdMs, order });
  }
  const matchedOrderKeys = new Set(matchedOrders.map((order, index) => collaborationOrderKey(order, index)));
  const newCustomerCount = [...earliestOrderByCustomer.values()].filter(item => (
    matchedOrderKeys.has(collaborationOrderKey(item.order))
  )).length;
  const currency = matchedOrders.find(order => order.currency)?.currency || "eur";
  const totals = matchedOrders.reduce((acc, order) => {
    const pricing = orderPricing(order);
    acc.revenueCents += Number(pricing.total || order.amountTotal || 0);
    acc.discountCents += Number(order.amountDiscount || pricing.discount || 0);
    acc.subtotalCents += Number(pricing.subtotal || order.amountSubtotal || 0);
    const createdMs = millisFromTimestamp(order.createdAt);
    if (createdMs > acc.lastOrderAtMs) {
      acc.lastOrderAtMs = createdMs;
      acc.lastOrderAt = order.createdAt || null;
    }
    return acc;
  }, { revenueCents: 0, discountCents: 0, subtotalCents: 0, lastOrderAtMs: 0, lastOrderAt: null });
  const couponOrders = coupon ? matchedOrders.filter(order => couponCodeForOrder(order) === coupon).length : 0;
  const referralOrders = referral ? matchedOrders.filter(order => referralCodeForOrder(order) === referral).length : 0;
  return {
    couponCode: coupon,
    referralCode: referral,
    orderCount: matchedOrders.length,
    couponOrderCount: couponOrders,
    referralOrderCount: referralOrders,
    customerCount: matchedCustomerKeys.size,
    newCustomerCount,
    revenueCents: totals.revenueCents,
    discountCents: totals.discountCents,
    subtotalCents: totals.subtotalCents,
    currency,
    lastOrderAt: totals.lastOrderAt,
    recentOrders: matchedOrders.slice(0, 8).map(order => ({
      ...publicOrderSummary(order),
      couponCode: couponCodeForOrder(order),
      referralCode: referralCodeForOrder(order),
      attributionSource: referral && referralCodeForOrder(order) === referral ? "referral" : "coupon",
      discountCents: Number(order.amountDiscount || orderPricing(order).discount || 0),
      customerEmail: order.customer?.email || "",
      customerName: order.customer?.name || "",
    })),
  };
}

function collaborationMetrics(collaboration = {}, orders = []) {
  return pilotMetrics(collaborationMetricsForAttribution({
    couponCode: collaboration.offer?.couponCode || "",
    referralCode: collaboration.referralCode || "",
  }, orders), collaboration.pilot || {});
}

function collaborationMetricsForCode(couponCode = "", orders = []) {
  return collaborationMetricsForAttribution({ couponCode }, orders);
}

async function collaborationMetricsMap(collaborations = []) {
  const keys = collaborations
    .map(item => {
      const coupon = normalizeCouponCode(item.offer?.couponCode || "");
      const referral = normalizeReferralCode(item.referralCode || "");
      return coupon || referral ? `${coupon}::${referral}` : "";
    })
    .filter(Boolean);
  if (!keys.length) return new Map();
  const snap = await db.collection("orders").orderBy("createdAt", "desc").limit(1000).get();
  const orders = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  const metrics = new Map();
  for (const key of keys) {
    const [couponCode, referralCode] = key.split("::");
    const collaboration = collaborations.find(item => (
      normalizeCouponCode(item.offer?.couponCode || "") === couponCode &&
      normalizeReferralCode(item.referralCode || "") === referralCode
    ));
    metrics.set(key, collaborationMetrics(collaboration || {}, orders));
  }
  return metrics;
}

function collaborationPrompt(collaboration = {}) {
  const social = collaboration.socialLinks || {};
  return [
    `Collaboration: ${collaboration.name || "Unnamed lead"}`,
    collaboration.contactName ? `Contact: ${collaboration.contactName}` : "",
    collaboration.category ? `Category: ${collaboration.category}` : "",
    collaboration.type ? `Collaboration type: ${collaboration.type}` : "",
    collaboration.status ? `Status: ${collaboration.status}` : "",
    collaboration.score ? `Lead score: ${collaboration.score}/100` : "",
    collaboration.email ? `Email: ${collaboration.email}` : "",
    social.instagram ? `Instagram: ${social.instagram}` : "",
    social.facebook ? `Facebook: ${social.facebook}` : "",
    social.tiktok ? `TikTok: ${social.tiktok}` : "",
    social.youtube ? `YouTube: ${social.youtube}` : "",
    collaboration.audienceNotes ? `Audience notes: ${collaboration.audienceNotes}` : "",
    collaboration.offer?.products ? `Products offered: ${collaboration.offer.products}` : "",
    collaboration.offer?.quantity ? `Quantity: ${collaboration.offer.quantity}` : "",
    collaboration.offer?.couponCode ? `Coupon code: ${collaboration.offer.couponCode}` : "",
    collaboration.referralCode ? `Referral code: ${collaboration.referralCode}` : "",
    collaboration.referralCode ? `Referral link: https://grubz.gr/?ref=${encodeURIComponent(collaboration.referralCode)}#products` : "",
    collaboration.offer?.commission ? `Commission: ${collaboration.offer.commission}` : "",
    collaboration.offer?.shippingCovered ? "Shipping covered: yes" : "Shipping covered: no",
    collaboration.offer?.details ? `Offer details: ${collaboration.offer.details}` : "",
    collaboration.commitments?.length ? `Content commitments:\n${collaboration.commitments.map(item => `- ${item}`).join("\n")}` : "",
    collaboration.notes ? `Internal notes: ${collaboration.notes}` : "",
  ].filter(Boolean).join("\n");
}

async function generateCollaborationOutreach({ client, model, collaboration = {}, language = "auto", channel = "dm" }) {
  const targetLanguage = language === "el" ? "Greek" : language === "en" ? "English" : "the most natural language for the lead";
  const response = await client.responses.create({
    model,
    instructions: [
      "Draft a concise GRUBZ collaboration outreach message for a human admin to review before sending.",
      `Write in ${targetLanguage}.`,
      `Channel: ${channel}.`,
      "The message should be warm, specific, practical, and not pushy.",
      "Make the collaboration offer clear, including product, content expectation, coupon or commission when provided.",
      "Do not invent audience metrics, follower counts, order history, payments, or commitments that are not in the context.",
      "Return only the message text.",
    ].join("\n"),
    input: collaborationPrompt(collaboration),
    max_output_tokens: 700,
    store: false,
  });
  return sanitizeChatText(responseTextFromOpenAI(response), 5000);
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

function marketingSessionId(value = "") {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 120);
}

function marketingCartItems(items = []) {
  return (Array.isArray(items) ? items : [])
    .slice(0, 30)
    .map(item => ({
      id: String(item.id || item.productId || "").trim().slice(0, 120),
      qty: Math.max(1, Math.min(999, Math.round(Number(item.qty || item.quantity || 1)))),
      name: String(item.name || "").trim().slice(0, 180),
      amount: Math.max(0, Math.round(Number(item.amount || item.unitAmount || 0))),
    }))
    .filter(item => item.id);
}

function marketingDocId(...parts) {
  const key = parts.map(part => String(part || "").trim().toLowerCase()).filter(Boolean).join("|") || randomUUID();
  return createHash("sha256").update(key).digest("hex").slice(0, 40);
}

function publicMarketingRecord(id, data = {}) {
  return {
    id,
    email: data.email || "",
    name: data.name || "",
    phone: data.phone || "",
    source: data.source || "",
    couponCode: data.couponCode || "",
    status: data.status || "",
    cartItems: Array.isArray(data.cartItems) ? data.cartItems : [],
    cartValueCents: Number(data.cartValueCents || 0),
    notes: data.notes || "",
    language: data.language || "",
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    lastCartAt: data.lastCartAt || null,
    contactedAt: data.contactedAt || null,
    recoveredAt: data.recoveredAt || null,
    dismissedAt: data.dismissedAt || null,
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

async function chatMessagesForConversation(conversationId, limit = 100, options = {}) {
  const max = Math.min(200, Math.max(1, Number(limit || 100)));
  const ref = db.collection(CHAT_CONVERSATIONS_COLLECTION).doc(conversationId)
    .collection("messages");
  if (options.latest === true) {
    const snap = await ref
      .orderBy("createdAt", "desc")
      .limit(max)
      .get();
    return snap.docs
      .map(doc => publicChatMessage(doc.id, doc.data()))
      .reverse();
  }
  const snap = await ref
    .orderBy("createdAt", "asc")
    .limit(max)
    .get();
  return snap.docs.map(doc => publicChatMessage(doc.id, doc.data()));
}

async function scanSocialAgent(settings = {}, adminUser = {}) {
  if (settings.enabled === false) throw Object.assign(new Error("Marketing is disabled"), { status: 400 });
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
  const assignedEmail = normalizedEmail(coupon.assignedEmail || "");
  if (assignedEmail && assignedEmail !== normalizedEmail(email || "")) {
    throw new Error("This coupon belongs to a different customer");
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
      ...(Number(coupon.maxRedemptions || 0) > 0 ? { max_redemptions: Number(coupon.maxRedemptions) } : {}),
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

function normalizeOrderAttribution(input = {}) {
  const source = analyticsSafeString(input.source || "Direct / unknown", 120) || "Direct / unknown";
  return {
    source,
    medium: analyticsSafeString(input.medium || "", 120),
    campaign: analyticsSafeString(input.campaign || "", 180),
    content: analyticsSafeString(input.content || "", 180),
    term: analyticsSafeString(input.term || "", 180),
    clickId: analyticsSafeString(input.clickId || "", 300),
    landingPage: analyticsSafeString(input.landingPage || "", 500),
    referrer: analyticsSafeString(input.referrer || "", 500),
    sessionId: analyticsSafeString(input.sessionId || "", 160),
  };
}

function orderAttributionFromMetadata(metadata = {}) {
  return normalizeOrderAttribution({
    source: metadata.attributionSource,
    medium: metadata.attributionMedium,
    campaign: metadata.attributionCampaign,
    content: metadata.attributionContent,
    term: metadata.attributionTerm,
    clickId: metadata.attributionClickId,
    landingPage: metadata.attributionLandingPage,
    referrer: metadata.attributionReferrer,
    sessionId: metadata.attributionSessionId,
  });
}

async function createCashOnDeliveryOrder({ uid, email, items, shipping, couponCode, referralCode = "", attribution = {}, productsMap, stripeMode = "", language = "en", boxNowConfig = null }) {
  const effectiveStripeMode = sanitizeStripeMode(stripeMode || (await getStripeSettings()).mode || "test");
  const orderLanguage = String(language || "en").trim().toLowerCase() === "el" ? "el" : "en";
  const orderReferralCode = normalizeReferralCode(referralCode || shipping?.referralCode || "");
  const orderItems = orderItemsFromCart(items, productsMap, effectiveStripeMode);
  const amountSubtotal = orderItemsSubtotal({ items: orderItems });
  const boxNowFee = await calculateBoxNowFee(items, shipping, productsMap, boxNowConfig);
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
    language: orderLanguage,
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
      line1: String(shipping?.line1 || shipping?.addressLine1 || "").trim(),
      addressLine1: String(shipping?.addressLine1 || shipping?.line1 || "").trim(),
      line2: String(shipping?.line2 || shipping?.addressLine2 || "").trim(),
      addressLine2: String(shipping?.addressLine2 || shipping?.line2 || "").trim(),
      city: String(shipping?.city || "").trim(),
      region: String(shipping?.region || "").trim(),
      postal: String(shipping?.postal || shipping?.postalCode || "").trim(),
      postalCode: String(shipping?.postalCode || shipping?.postal || "").trim(),
      country: String(shipping?.country || "Greece").trim() || "Greece",
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
      environment: boxNowFee.environment || "",
      apiBaseUrl: boxNowFee.apiBaseUrl || "",
    },
    couponCode: couponResult.coupon?.code || "",
    couponId: couponResult.coupon?.id || "",
    referralCode: orderReferralCode,
    attribution: normalizeOrderAttribution(attribution),
    metadata: {
      orderNumber,
      uid: uid || "guest",
      paymentMethod: "cash_on_delivery",
      cashOnDelivery: "true",
      couponCode: couponResult.coupon?.code || "",
      referralCode: orderReferralCode,
      language: orderLanguage,
    },
    createdAt: now(),
    updatedAt: now(),
  };

  await db.collection("orders").doc(id).set(order, { merge: true });
  await transitionOrderInventory(id, "reserved", "cash_on_delivery_order");
  await recordCouponRedemption({ coupon: couponResult.coupon, order, discountCents: discountAmount });
  return order;
}

async function createCourierQuoteOrder({ uid, email, items, shipping, couponCode, referralCode = "", attribution = {}, productsMap, language = "en" }) {
  const addressLine1 = String(shipping?.line1 || shipping?.addressLine1 || "").trim();
  const city = String(shipping?.city || "").trim();
  if (!addressLine1 || !city) throw new Error("Street address and city are required for courier delivery");

  const stripeMode = sanitizeStripeMode((await getStripeSettings()).mode || "test");
  const orderItems = orderItemsFromCart(items, productsMap, stripeMode);
  const amountSubtotal = orderItemsSubtotal({ items: orderItems });
  const couponResult = await calculateCouponDiscountCents(couponCode, items, productsMap, {
    uid,
    email,
    stripeMode,
  });
  const amountDiscount = couponResult.discountCents;
  const productsTotal = Math.max(0, amountSubtotal - amountDiscount);
  const orderNumber = generateOrderNumber();
  const id = `courier_quote_${orderNumber.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
  const orderLanguage = String(language || "en").trim().toLowerCase() === "el" ? "el" : "en";
  const orderReferralCode = normalizeReferralCode(referralCode || "");
  const order = {
    id,
    orderNumber,
    uid,
    source: "storefront_courier_quote",
    stripeMode,
    stripeSessionId: "",
    stripePaymentIntentId: "",
    paymentMethod: "payment_link_after_shipping_quote",
    status: "awaiting_shipping_quote",
    fulfillmentStatus: "new",
    language: orderLanguage,
    paymentStatus: "awaiting_shipping_quote",
    amountSubtotal,
    amountShipping: 0,
    amountDiscount,
    amountTotal: productsTotal,
    amountDue: productsTotal,
    shippingQuotePending: true,
    currency: "eur",
    items: orderItems,
    customer: {
      email: email || "",
      name: String(shipping?.name || "").trim(),
      phone: String(shipping?.phone || "").trim(),
    },
    shipping: {
      deliveryMethod: "courier_quote",
      name: String(shipping?.name || "").trim(),
      phone: String(shipping?.phone || "").trim(),
      line1: addressLine1,
      addressLine1,
      line2: String(shipping?.line2 || shipping?.addressLine2 || "").trim(),
      addressLine2: String(shipping?.line2 || shipping?.addressLine2 || "").trim(),
      city,
      region: String(shipping?.region || "").trim(),
      postal: String(shipping?.postal || shipping?.postalCode || "").trim(),
      postalCode: String(shipping?.postal || shipping?.postalCode || "").trim(),
      country: String(shipping?.country || "Greece").trim() || "Greece",
      cashOnDelivery: false,
      trackingNumber: "",
      trackingUrl: "",
    },
    couponCode: couponResult.coupon?.code || "",
    couponId: couponResult.coupon?.id || "",
    referralCode: orderReferralCode,
    attribution: normalizeOrderAttribution(attribution),
    metadata: {
      orderNumber,
      uid,
      paymentMethod: "payment_link_after_shipping_quote",
      deliveryMethod: "courier_quote",
      couponCode: couponResult.coupon?.code || "",
      referralCode: orderReferralCode,
      language: orderLanguage,
    },
    createdAt: now(),
    updatedAt: now(),
  };

  await db.collection("orders").doc(id).set(order);
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
    language: String(metadata.language || "en").trim().toLowerCase() === "el" ? "el" : "en",
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
      line1: metadata.shippingAddressLine1 || "",
      addressLine1: metadata.shippingAddressLine1 || "",
      line2: metadata.shippingAddressLine2 || "",
      addressLine2: metadata.shippingAddressLine2 || "",
      city: metadata.shippingCity || "",
      region: metadata.shippingRegion || "",
      postal: metadata.shippingPostalCode || "",
      postalCode: metadata.shippingPostalCode || "",
      country: metadata.shippingCountry || "Greece",
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
      environment: metadata.boxnowEnvironment || "",
      apiBaseUrl: metadata.boxnowApiBaseUrl || "",
    },
    couponCode: metadata.couponCode || "",
    couponId: metadata.couponId || "",
    referralCode: normalizeReferralCode(metadata.referralCode || ""),
    attribution: orderAttributionFromMetadata(metadata),
    amountDiscount: Number(session.total_details?.amount_discount || metadata.couponDiscountCents || 0),
    metadata,
    createdAt: session.created ? Timestamp.fromMillis(session.created * 1000) : now(),
    updatedAt: now(),
  };

  await db.collection("orders").doc(id).set(order, { merge: true });
  if (order.paymentStatus === "paid") await transitionOrderInventory(id, "reserved", "stripe_payment");
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
    language: String(metadata.language || "en").trim().toLowerCase() === "el" ? "el" : "en",
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
      line1: metadata.shippingAddressLine1 || "",
      addressLine1: metadata.shippingAddressLine1 || "",
      line2: metadata.shippingAddressLine2 || "",
      addressLine2: metadata.shippingAddressLine2 || "",
      city: metadata.shippingCity || "",
      region: metadata.shippingRegion || "",
      postal: metadata.shippingPostalCode || "",
      postalCode: metadata.shippingPostalCode || "",
      country: metadata.shippingCountry || "Greece",
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
      environment: metadata.boxnowEnvironment || "",
      apiBaseUrl: metadata.boxnowApiBaseUrl || "",
    },
    couponCode: metadata.couponCode || "",
    couponId: metadata.couponId || "",
    referralCode: normalizeReferralCode(metadata.referralCode || ""),
    attribution: orderAttributionFromMetadata(metadata),
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
  if (type === "courier_quote_order") return "Courier shipping quote requested";
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

function analyticsDayKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function analyticsSafeString(value = "", max = 240) {
  return String(value || "").trim().slice(0, max);
}

function sanitizeAnalyticsEvent(input = {}) {
  const event = analyticsSafeString(input.event || input.name || "", 80)
    .toLowerCase()
    .replace(/[^a-z0-9_:-]/g, "_");
  if (!event) throw Object.assign(new Error("Missing analytics event"), { status: 400 });
  const sessionId = analyticsSafeString(input.sessionId || "", 120).replace(/[^a-zA-Z0-9_-]/g, "");
  if (!sessionId) throw Object.assign(new Error("Missing analytics session"), { status: 400 });
  const props = input.props && typeof input.props === "object" ? input.props : {};
  const cleanProps = {};
  for (const [key, value] of Object.entries(props).slice(0, 30)) {
    const cleanKey = analyticsSafeString(key, 60).replace(/[^a-zA-Z0-9_-]/g, "_");
    if (!cleanKey) continue;
    if (typeof value === "number" || typeof value === "boolean") {
      cleanProps[cleanKey] = value;
    } else if (value == null) {
      cleanProps[cleanKey] = "";
    } else {
      cleanProps[cleanKey] = analyticsSafeString(value, 300);
    }
  }
  return {
    event,
    sessionId,
    page: analyticsSafeString(input.page || "/", 180),
    path: analyticsSafeString(input.path || "", 180),
    referrer: analyticsSafeString(input.referrer || "", 300),
    attribution: {
      source: analyticsSafeString(input.attribution?.source || "", 120),
      medium: analyticsSafeString(input.attribution?.medium || "", 120),
      campaign: analyticsSafeString(input.attribution?.campaign || "", 180),
      content: analyticsSafeString(input.attribution?.content || "", 180),
      term: analyticsSafeString(input.attribution?.term || "", 180),
      clickId: analyticsSafeString(input.attribution?.clickId || "", 300),
      landingPage: analyticsSafeString(input.attribution?.landingPage || "", 300),
    },
    language: analyticsSafeString(input.language || "", 20),
    device: analyticsSafeString(input.device || "", 40),
    props: cleanProps,
  };
}

function addAnalyticsBreakdown(map, key, count = 1) {
  const label = analyticsSafeString(key || "Unknown", 160) || "Unknown";
  map.set(label, (map.get(label) || 0) + Number(count || 0));
}

function analyticsMapRows(map, limit = 12) {
  return [...map.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => Number(b.count || 0) - Number(a.count || 0) || a.label.localeCompare(b.label))
    .slice(0, limit);
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
  const status = String(order.status || "").trim().toLowerCase();
  const paymentStatus = String(order.paymentStatus || "").trim().toLowerCase();
  const paidStatuses = new Set(["paid", "complete", "succeeded"]);
  const isPaid = paymentStatus
    ? paidStatuses.has(paymentStatus)
    : paidStatuses.has(status);

  if (email && !customer.email) customer.email = email;
  if (name && !customer.name) customer.name = name;
  if (phone && !customer.phone) customer.phone = phone;
  if (shipping && Object.keys(shipping).length && (!customer.shipping || createdAtMs >= customer.lastOrderAtMs)) {
    const existingShipping = customer.shipping && typeof customer.shipping === "object" ? customer.shipping : {};
    const existingBoxNow = existingShipping.boxNow && typeof existingShipping.boxNow === "object" ? existingShipping.boxNow : {};
    const orderBoxNow = shipping.boxNow && typeof shipping.boxNow === "object" ? shipping.boxNow : {};
    const savedShippingValue = (...keys) => {
      for (const key of keys) {
        if (String(existingShipping[key] || "").trim()) return existingShipping[key];
      }
      for (const key of keys) {
        if (String(shipping[key] || "").trim()) return shipping[key];
      }
      return "";
    };
    customer.shipping = {
      ...existingShipping,
      ...shipping,
      addressLine1: savedShippingValue("addressLine1", "line1", "address"),
      line1: savedShippingValue("line1", "addressLine1", "address"),
      addressLine2: savedShippingValue("addressLine2", "line2"),
      line2: savedShippingValue("line2", "addressLine2"),
      postalCode: savedShippingValue("postalCode", "postal", "zip"),
      postal: savedShippingValue("postal", "postalCode", "zip"),
      city: savedShippingValue("city"),
      region: savedShippingValue("region"),
      country: savedShippingValue("country"),
      boxNow: {
        ...existingBoxNow,
        ...orderBoxNow,
      },
    };
  }
  customer.orderCount += 1;
  if (isPaid) {
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
    alternateUids: [],
    email: data.email || data.emailLower || "",
    name: data.name || data.displayName || "",
    phone: data.phone || "",
    shipping: data.shipping && typeof data.shipping === "object"
      ? normalizeCustomerShipping(data.shipping)
      : null,
    notes: data.notes || "",
    tags: Array.isArray(data.tags) ? data.tags : [],
    creatorCollaborator: data.creatorCollaborator === true,
    collaborationId: data.collaborationId || "",
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

function mergeCustomerProfile(target, source = {}) {
  if (!target || !source || target === source) return target;
  const sourceUid = String(source.uid || "").trim();
  if (sourceUid && sourceUid !== target.uid) {
    const alternateUids = new Set(Array.isArray(target.alternateUids) ? target.alternateUids : []);
    alternateUids.add(sourceUid);
    target.alternateUids = Array.from(alternateUids);
  }
  if (!target.email && source.email) target.email = source.email;
  if (!target.name && source.name) target.name = source.name;
  if (!target.phone && source.phone) target.phone = source.phone;
  if (!target.shipping && source.shipping) target.shipping = source.shipping;
  if (!target.notes && source.notes) target.notes = source.notes;
  target.creatorCollaborator = target.creatorCollaborator === true || source.creatorCollaborator === true;
  if (!target.collaborationId && source.collaborationId) target.collaborationId = source.collaborationId;
  const tags = new Set([
    ...(Array.isArray(target.tags) ? target.tags : []),
    ...(Array.isArray(source.tags) ? source.tags : []),
  ].filter(Boolean));
  target.tags = Array.from(tags);
  if (!target.createdAt || (source.createdAt && millisFromTimestamp(source.createdAt) < millisFromTimestamp(target.createdAt))) {
    target.createdAt = source.createdAt;
  }
  if (!target.updatedAt || (source.updatedAt && millisFromTimestamp(source.updatedAt) > millisFromTimestamp(target.updatedAt))) {
    target.updatedAt = source.updatedAt;
  }
  return target;
}

function validEmailAddress(value = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function textToBasicHtml(text = "") {
  return escapeHtml(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(line => line || " ")
    .join("<br>\n");
}

function customerEmailTemplateValue(value = "", customer = {}, context = {}) {
  const language = String(context.language || "en").trim().toLowerCase() === "el" ? "el" : "en";
  const placeholders = sanitizeEmailPlaceholderSettings(context.placeholders || {});
  const customerName = String(customer.name || "").trim();
  const greetingTemplate = customerName ? placeholders.greeting[language] : placeholders.greetingNoName[language];
  const replacements = {
    greeting: greetingTemplate.replace(/\{customerName\}/g, customerName),
    customerName,
    customerEmail: customer.email || "",
    customerPhone: customer.phone || "",
    coupon: context.coupon || "",
    grubz_url: GRUBZ_URL,
    feedback_url: context.feedbackUrl || `${GRUBZ_URL}/feedback/`,
    unsubscribe_url: context.unsubscribeUrl || "",
  };
  return String(value || "").replace(/\{(greeting|customerName|customerEmail|customerPhone|coupon|grubz_url|feedback_url|unsubscribe_url)\}/g, (_, key) => replacements[key] || "");
}

function customerEmailTemplateHtml(value = "", customer = {}, context = {}) {
  const language = String(context.language || "en").trim().toLowerCase() === "el" ? "el" : "en";
  const placeholders = sanitizeEmailPlaceholderSettings(context.placeholders || {});
  const customerName = String(customer.name || "").trim();
  const greetingTemplate = customerName ? placeholders.greeting[language] : placeholders.greetingNoName[language];
  const replacements = {
    greeting: greetingTemplate.replace(/\{customerName\}/g, customerName),
    customerName,
    customerEmail: customer.email || "",
    customerPhone: customer.phone || "",
    coupon: context.coupon || "",
    grubz_url: GRUBZ_URL,
    feedback_url: context.feedbackUrl || `${GRUBZ_URL}/feedback/`,
    unsubscribe_url: context.unsubscribeUrl || "",
  };
  const html = String(value || "").replace(/\{(greeting|customerName|customerEmail|customerPhone|coupon|grubz_url|feedback_url|unsubscribe_url)\}/g, (_, key) => {
    const escaped = escapeHtml(replacements[key] || "");
    return (key === "coupon" || key === "orderNumber") && escaped ? `<strong>${escaped}</strong>` : escaped;
  });
  return html
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(line => line || " ")
    .join("<br>\n");
}

function containsCouponPlaceholder(value = "") {
  return /\{\s*coupon\s*\}/i.test(String(value || ""));
}

function containsOrderOnlyPlaceholder(value = "") {
  return /\{\s*(orderNumber|status|previousStatus|fulfillmentStatus|previousFulfillmentStatus|trackingNumber|trackingUrl|total|boxNowLocker|orderDetails)\s*\}/i.test(String(value || ""));
}

async function sendBulkCustomerEmail({ adminUser, recipients, subject, body, coupon, language }) {
  const cleanSubject = String(subject || "").trim().slice(0, 180);
  const cleanBody = String(body || "").trim().slice(0, 12000);
  const couponCode = normalizeCouponCode(coupon || "").slice(0, 80);
  const emailLanguage = String(language || "en").trim().toLowerCase() === "el" ? "el" : "en";
  if (!cleanSubject) throw Object.assign(new Error("Enter an email subject."), { status: 400 });
  if (!cleanBody) throw Object.assign(new Error("Enter an email message."), { status: 400 });
  if (containsCouponPlaceholder(cleanBody) && !couponCode) {
    throw Object.assign(new Error("Select a coupon or remove the {coupon} placeholder before sending."), { status: 400 });
  }
  if (containsOrderOnlyPlaceholder(`${cleanSubject}\n${cleanBody}`)) {
    throw Object.assign(new Error("Customer emails cannot use order placeholders. Choose a customer template or remove order placeholders."), { status: 400 });
  }
  if (!Array.isArray(recipients) || !recipients.length) {
    throw Object.assign(new Error("Choose at least one customer with an email address."), { status: 400 });
  }

  const uniqueRecipients = [];
  const seen = new Set();
  for (const item of recipients) {
    const email = normalizedEmail(item?.email || "");
    if (!email || seen.has(email) || !validEmailAddress(email)) continue;
    seen.add(email);
    uniqueRecipients.push({
      email,
      name: String(item?.name || "").trim().slice(0, 180),
      phone: String(item?.phone || "").trim().slice(0, 80),
      key: String(item?.key || "").trim().slice(0, 240),
      uid: String(item?.uid || "").trim().slice(0, 128),
    });
  }

  if (!uniqueRecipients.length) {
    throw Object.assign(new Error("Choose at least one customer with a valid email address."), { status: 400 });
  }
  if (uniqueRecipients.length > 250) {
    throw Object.assign(new Error("Send to 250 customers or fewer at once."), { status: 400 });
  }

  const batchRef = db.collection("bulkCustomerEmails").doc();
  const from = secretValue(ORDER_NOTIFICATION_FROM, defaultNotificationFrom());
  const emailSettings = await getOrderEmailSettings();
  await batchRef.set({
    subject: cleanSubject,
    coupon: couponCode,
    language: emailLanguage,
    recipientCount: uniqueRecipients.length,
    recipients: uniqueRecipients.map(({ email, name, key, uid }) => ({ email, name, key, uid })),
    status: "sending",
    createdAt: now(),
    createdBy: adminUser.uid || "",
    createdByEmail: adminUser.email || "",
  });

  const results = [];
  let monitoringBccSent = false;
  for (const recipient of uniqueRecipients) {
    try {
      const context = { coupon: couponCode, language: emailLanguage, placeholders: emailSettings.placeholders };
      const personalizedSubject = customerEmailTemplateValue(cleanSubject, recipient, context);
      const personalizedText = customerEmailTemplateValue(cleanBody, recipient, context);
      const personalizedHtml = customerEmailTemplateHtml(cleanBody, recipient, context);
      const testModeSubject = BULK_CUSTOMER_EMAIL_TEST_MODE
        ? `[TEST to ${recipient.email}] ${personalizedSubject}`
        : personalizedSubject;
      const to = BULK_CUSTOMER_EMAIL_TEST_MODE ? GRUBZ_INFO_EMAIL : recipient.email;
      const bcc = !BULK_CUSTOMER_EMAIL_TEST_MODE && !monitoringBccSent ? GRUBZ_INFO_EMAIL : undefined;
      const result = await sendEmail({
        to,
        from,
        bcc,
        subject: testModeSubject,
        text: personalizedText,
        html: personalizedHtml,
      });
      if (result.skipped) throw new Error(result.reason || "Email skipped");
      if (bcc) monitoringBccSent = true;
      results.push({
        email: recipient.email,
        deliveredTo: to,
        monitoringBcc: Boolean(bcc),
        testMode: BULK_CUSTOMER_EMAIL_TEST_MODE,
        ok: !result.skipped,
        skipped: Boolean(result.skipped),
        reason: result.reason || "",
        messageId: result.messageId || "",
      });
    } catch (err) {
      results.push({
        email: recipient.email,
        ok: false,
        error: err.message || "Email failed",
      });
    }
  }

  const sent = results.filter(item => item.ok).length;
  const skipped = results.filter(item => item.skipped).length;
  const failed = results.length - sent - skipped;
  await batchRef.set({
    status: failed ? "partial" : skipped && !sent ? "skipped" : "sent",
    sent,
    skipped,
    failed,
    results,
    updatedAt: now(),
    sentAt: sent ? now() : null,
  }, { merge: true });

  return { ok: failed === 0, id: batchRef.id, sent, skipped, failed, results };
}

function newsletterSubscriberId(email = "") {
  return createHash("sha256").update(normalizedEmail(email)).digest("hex");
}

function newsletterPublicBaseUrl(req = null) {
  const origin = String(req?.get?.("origin") || "").trim().replace(/\/+$/, "");
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  const forwardedHost = String(req?.get?.("x-forwarded-host") || req?.get?.("host") || "").split(",")[0].trim();
  if (/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(forwardedHost)) {
    const protocol = String(req?.get?.("x-forwarded-proto") || "http").split(",")[0].trim() === "https" ? "https" : "http";
    return `${protocol}://${forwardedHost}`;
  }
  return GRUBZ_URL;
}

function newsletterUnsubscribeUrl(token = "", publicBaseUrl = GRUBZ_URL) {
  return `${String(publicBaseUrl || GRUBZ_URL).replace(/\/+$/, "")}/api/newsletter?action=unsubscribe&token=${encodeURIComponent(String(token || ""))}`;
}

function newsletterFromAddress() {
  const configured = secretValue(ORDER_NOTIFICATION_FROM, defaultNotificationFrom());
  const address = emailAddressFromHeader(configured) || secretValue(SMTP_USER) || GRUBZ_INFO_EMAIL;
  return `GRUBZ Newsletter <${address}>`;
}

function publicNewsletterSubscriber(doc) {
  const data = doc.data ? doc.data() : doc;
  return {
    id: doc.id || "",
    email: normalizedEmail(data.email || ""),
    name: String(data.name || ""),
    language: String(data.language || "en") === "el" ? "el" : "en",
    status: data.status === "subscribed" ? "subscribed" : "unsubscribed",
    source: String(data.source || ""),
    subscribedAt: data.subscribedAt || null,
    unsubscribedAt: data.unsubscribedAt || null,
    updatedAt: data.updatedAt || null,
  };
}

async function newsletterImageAttachment(rawImageUrl = "") {
  const dataMatch = String(rawImageUrl || "").match(/^data:(image\/(?:png|jpe?g|webp));base64,([a-z0-9+/=]+)$/i);
  if (dataMatch) {
    return {
      content: Buffer.from(dataMatch[2], "base64"),
      contentType: dataMatch[1].toLowerCase() === "image/jpg" ? "image/jpeg" : dataMatch[1].toLowerCase(),
    };
  }
  if (!/^https:\/\//i.test(String(rawImageUrl || ""))) return null;
  const parsedUrl = new URL(String(rawImageUrl));
  let storageBucket = "";
  let storagePath = "";
  if (parsedUrl.hostname === "storage.googleapis.com") {
    const parts = parsedUrl.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    storageBucket = parts.shift() || "";
    storagePath = parts.join("/");
  } else if (parsedUrl.hostname === "firebasestorage.googleapis.com") {
    const match = parsedUrl.pathname.match(/^\/v0\/b\/([^/]+)\/o\/(.+)$/);
    if (match) {
      storageBucket = decodeURIComponent(match[1]);
      storagePath = decodeURIComponent(match[2]);
    }
  }
  if (storageBucket && storagePath) {
    const file = getStorage().bucket(storageBucket).file(storagePath);
    const [[metadata], [content]] = await Promise.all([file.getMetadata(), file.download()]);
    const contentType = String(metadata.contentType || "").toLowerCase();
    if (!/^image\/(?:png|jpeg|jpg|webp)$/.test(contentType)) throw new Error("Newsletter image is not a supported image.");
    if (!content.length) throw new Error("Newsletter image is empty.");
    if (content.length > 5 * 1024 * 1024) throw new Error("Newsletter image must be smaller than 5 MB.");
    return { content, contentType: contentType === "image/jpg" ? "image/jpeg" : contentType };
  }
  const response = await fetch(String(rawImageUrl), {
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
    headers: { "user-agent": "GRUBZ Newsletter Image/1.0" },
  });
  if (!response.ok) throw new Error(`Newsletter image could not be downloaded (${response.status}).`);
  const contentType = String(response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!/^image\/(?:png|jpeg|jpg|webp)$/.test(contentType)) throw new Error("Newsletter image URL did not return a supported image.");
  const content = Buffer.from(await response.arrayBuffer());
  if (!content.length) throw new Error("Newsletter image is empty.");
  if (content.length > 5 * 1024 * 1024) throw new Error("Newsletter image must be smaller than 5 MB.");
  return { content, contentType: contentType === "image/jpg" ? "image/jpeg" : contentType };
}

async function sendNewsletter({ adminUser, subject, body, language = "en", testOnly = false, confirmDuplicate = false, publicBaseUrl = GRUBZ_URL, image = {} }) {
  const cleanSubject = String(subject || "").trim().slice(0, 180);
  const cleanBody = String(body || "").trim().slice(0, 12000);
  const emailLanguage = String(language || "en").toLowerCase() === "el" ? "el" : "en";
  const rawImageUrl = String(image.url || "").trim();
  const hasRemoteImage = /^https:\/\//i.test(rawImageUrl);
  const hasInlineImage = /^data:image\/(?:png|jpe?g|webp);base64,/i.test(rawImageUrl);
  const imageUrl = hasRemoteImage ? rawImageUrl.slice(0, 2000) : (hasInlineImage ? "inline:image" : "");
  const imageAlt = String(image.alt || "GRUBZ").trim().slice(0, 300) || "GRUBZ";
  const imageLink = /^https:\/\//i.test(String(image.link || "").trim()) ? String(image.link || "").trim().slice(0, 2000) : "";
  if (!cleanSubject || !cleanBody) {
    throw Object.assign(new Error("Enter a newsletter subject and message."), { status: 400 });
  }
  if (containsOrderOnlyPlaceholder(`${cleanSubject}\n${cleanBody}`)) {
    throw Object.assign(new Error("Newsletter templates cannot use order placeholders."), { status: 400 });
  }
  const contentHash = createHash("sha256")
    .update(JSON.stringify({ subject: cleanSubject, body: cleanBody, language: emailLanguage, imageUrl, imageAlt, imageLink }))
    .digest("hex");

  let recipients = [];
  if (testOnly) {
    recipients = [{
      id: "test",
      email: GRUBZ_INFO_EMAIL,
      name: "GRUBZ",
      language: emailLanguage,
      unsubscribeToken: "test",
    }];
  } else {
    const snap = await db.collection(NEWSLETTER_SUBSCRIBERS_COLLECTION)
      .where("status", "==", "subscribed")
      .limit(500)
      .get();
    recipients = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(item => validEmailAddress(item.email) && String(item.language || "en") === emailLanguage);
  }
  if (!recipients.length) {
    throw Object.assign(new Error(`No subscribed ${emailLanguage === "el" ? "Greek" : "English"} recipients found.`), { status: 400 });
  }

  if (!testOnly && !confirmDuplicate) {
    const recipientEmails = new Set(recipients.map(item => normalizedEmail(item.email)));
    const previousSnap = await db.collection(NEWSLETTER_SENDS_COLLECTION).orderBy("createdAt", "desc").limit(100).get();
    const duplicateRecipients = new Map();
    for (const doc of previousSnap.docs) {
      const previous = doc.data() || {};
      if (previous.testOnly) continue;
      const sameNewsletter = previous.contentHash
        ? previous.contentHash === contentHash
        : String(previous.subject || "").trim().toLowerCase() === cleanSubject.toLowerCase() && String(previous.language || "en") === emailLanguage;
      if (!sameNewsletter) continue;
      for (const result of Array.isArray(previous.results) ? previous.results : []) {
        const email = normalizedEmail(result.email || result.deliveredTo || "");
        if (result.ok && recipientEmails.has(email) && !duplicateRecipients.has(email)) {
          duplicateRecipients.set(email, previous.sentAt || previous.updatedAt || previous.createdAt || null);
        }
      }
    }
    if (duplicateRecipients.size) {
      throw Object.assign(new Error(`This newsletter was already sent to ${duplicateRecipients.size} selected subscriber${duplicateRecipients.size === 1 ? "" : "s"}.`), {
        status: 409,
        details: {
          code: "duplicate_newsletter_recipients",
          count: duplicateRecipients.size,
          recipients: [...duplicateRecipients.entries()].slice(0, 50).map(([email, sentAt]) => ({ email, sentAt })),
        },
      });
    }
  }

  const embeddedImage = imageUrl ? await newsletterImageAttachment(rawImageUrl) : null;

  const sendRef = db.collection(NEWSLETTER_SENDS_COLLECTION).doc();
  const from = newsletterFromAddress();
  let emailSettings;
  try {
    emailSettings = await getOrderEmailSettings();
  } catch (err) {
    if (!testOnly) throw err;
    logger.warn("Newsletter test is using default email placeholders because settings could not be loaded", { error: err.message || "settings_unavailable" });
    emailSettings = defaultOrderEmailSettings();
  }
  let historyAvailable = true;
  try {
    await sendRef.set({
    subject: cleanSubject,
    contentHash,
    language: emailLanguage,
    recipientCount: recipients.length,
    testOnly,
    status: "sending",
    createdAt: now(),
    createdBy: adminUser.uid || "",
    createdByEmail: adminUser.email || "",
    image: imageUrl ? { url: hasInlineImage ? "inline:image" : imageUrl, alt: imageAlt, link: imageLink } : null,
    });
  } catch (err) {
    if (!testOnly) throw err;
    historyAvailable = false;
    logger.warn("Newsletter test history could not be started; continuing with email delivery", { error: err.message || "history_unavailable" });
  }

  const results = [];
  let archiveBccSent = false;
  for (const recipient of recipients) {
    try {
      const unsubscribeUrl = testOnly
        ? `${String(publicBaseUrl || GRUBZ_URL).replace(/\/+$/, "")}/?newsletter=unsubscribed#newsletter`
        : newsletterUnsubscribeUrl(recipient.unsubscribeToken, publicBaseUrl);
      const context = {
        language: emailLanguage,
        placeholders: emailSettings.placeholders,
        unsubscribeUrl,
      };
      const personalizedSubject = customerEmailTemplateValue(cleanSubject, recipient, context);
      const imageText = embeddedImage && imageLink ? `\n\n${imageAlt}: ${imageLink}` : "";
      const personalizedText = `${customerEmailTemplateValue(cleanBody, recipient, context)}${imageText}\n\n${emailLanguage === "el" ? "Διαγραφή από το newsletter" : "Unsubscribe from this newsletter"}: ${unsubscribeUrl}`;
      let bodyHtml = customerEmailTemplateHtml(cleanBody, recipient, context);
      if (embeddedImage) {
        const img = `<img src="cid:newsletter-image" alt="${escapeHtml(imageAlt)}" width="600" style="display:block;width:100%;max-width:600px;height:auto;margin:20px 0;border:0;border-radius:14px;">`;
        const imageHtml = imageLink ? `<a href="${escapeHtml(imageLink)}" style="display:block;text-decoration:none;">${img}</a>` : img;
        const firstLineBreak = bodyHtml.indexOf("<br>\n");
        bodyHtml = firstLineBreak >= 0
          ? `${bodyHtml.slice(0, firstLineBreak + 5)}${imageHtml}${bodyHtml.slice(firstLineBreak + 5)}`
          : `${imageHtml}${bodyHtml}`;
      }
      const footerLabel = emailLanguage === "el" ? "Διαγραφή από το newsletter" : "Unsubscribe from this newsletter";
      const personalizedHtml = `${bodyHtml}<br><br><hr style="border:0;border-top:1px solid #e4e4e7"><p style="font-size:12px;color:#71717a"><a href="${escapeHtml(unsubscribeUrl)}">${footerLabel}</a></p>`;
      const result = await sendEmail({
        to: recipient.email,
        from,
        bcc: !testOnly && !archiveBccSent ? GRUBZ_INFO_EMAIL : "",
        subject: testOnly ? `[NEWSLETTER TEST] ${personalizedSubject}` : personalizedSubject,
        text: personalizedText,
        html: personalizedHtml,
        attachments: embeddedImage ? [{
          filename: `newsletter.${embeddedImage.contentType === "image/jpeg" ? "jpg" : embeddedImage.contentType.split("/")[1]}`,
          content: embeddedImage.content,
          contentType: embeddedImage.contentType,
          cid: "newsletter-image",
        }] : undefined,
      });
      if (result.skipped) throw new Error(result.reason || "Email skipped");
      archiveBccSent = true;
      results.push({ email: recipient.email, ok: true, messageId: result.messageId || "" });
    } catch (err) {
      logger.error("Newsletter email delivery failed", {
        recipient: recipient.email,
        code: err.code || "",
        command: err.command || "",
        responseCode: err.responseCode || null,
        response: err.response || "",
        error: err.message || "Email delivery failed",
      });
      results.push({ email: recipient.email, ok: false, error: err.message || "Email failed" });
    }
  }
  const sent = results.filter(item => item.ok).length;
  const failed = results.length - sent;
  if (historyAvailable) {
    try {
      await sendRef.set({
        status: failed ? "partial" : "sent",
        sent,
        failed,
        results,
        updatedAt: now(),
        sentAt: sent ? now() : null,
      }, { merge: true });
    } catch (err) {
      if (!testOnly) throw err;
      logger.warn("Newsletter test was delivered but its history could not be updated", { error: err.message || "history_unavailable" });
    }
  }
  return { ok: failed === 0, id: historyAvailable ? sendRef.id : "", sent, failed, results, recipientCount: recipients.length, testOnly };
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
  const shipping = order.shipping || {};
  const courierQuote = shipping.deliveryMethod === "courier_quote";
  const deliveryLines = courierQuote ? [
    [shipping.addressLine1 || shipping.line1, shipping.addressLine2 || shipping.line2].filter(Boolean).join(", ") || "-",
    [shipping.postalCode || shipping.postal, shipping.city, shipping.region].filter(Boolean).join(", ") || "-",
    shipping.country || "Greece",
  ] : lockerLines;
  const total = formatMoney(order.amountTotal, order.currency);
  const text = [
    title,
    "",
    `Order: ${orderNumber}`,
    `Status: ${order.status || ""}`,
    `Payment status: ${order.paymentStatus || ""}`,
    `Payment method: ${order.paymentMethod || "card"}`,
    `${courierQuote ? "Products total before shipping" : "Total"}: ${total}`,
    "",
    "Customer",
    `Name: ${customer.name || "-"}`,
    `Email: ${customer.email || "-"}`,
    `Phone: ${customer.phone || "-"}`,
    "",
    courierQuote ? "Courier delivery address" : "BOX NOW locker",
    ...deliveryLines,
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
    <strong>${courierQuote ? "Products total before shipping" : "Total"}:</strong> ${escapeHtml(total)}</p>
    <h3>Customer</h3>
    <p>${escapeHtml(customer.name || "-")}<br>
    ${escapeHtml(customer.email || "-")}<br>
    ${escapeHtml(customer.phone || "-")}</p>
    <h3>${courierQuote ? "Courier delivery address" : "BOX NOW locker"}</h3>
    <p>${deliveryLines.map(line => escapeHtml(line)).join("<br>\n")}</p>
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

const DEFAULT_EMAIL_PLACEHOLDERS = {
  greeting: {
    en: "Hi {customerName},",
    el: "Γεια σου {customerName},",
  },
  greetingNoName: {
    en: "Hi,",
    el: "Γεια σου,",
  },
};

function sanitizeEmailPlaceholderSettings(input = {}, existing = {}) {
  const source = {
    ...DEFAULT_EMAIL_PLACEHOLDERS,
    ...(existing || {}),
    ...(input || {}),
  };
  const sanitizeEntry = (key, lang) => String(source[key]?.[lang] || DEFAULT_EMAIL_PLACEHOLDERS[key][lang] || "")
    .trim()
    .slice(0, 240);
  return {
    greeting: {
      en: sanitizeEntry("greeting", "en"),
      el: sanitizeEntry("greeting", "el"),
    },
    greetingNoName: {
      en: sanitizeEntry("greetingNoName", "en"),
      el: sanitizeEntry("greetingNoName", "el"),
    },
  };
}

function emailTemplateContext(template = {}) {
  const raw = String(template.templateContext || template.context || template.emailContext || "").trim().toLowerCase();
  if (raw === "customer" || raw === "order" || raw === "newsletter" || raw === "feedback") return raw;
  const status = normalizeOrderStatus(template.fulfillmentStatus || template.status || "");
  return status === "abandoned_signup" ? "customer" : "order";
}

function sanitizeOrderEmailSettings(input = {}) {
  return sanitizeOrderEmailSettingsInternal(input, { includeDefaults: true });
}

function sanitizeOrderEmailSettingsInternal(input = {}, { includeDefaults = true } = {}) {
  const templates = Array.isArray(input.templates) ? input.templates : [];
  const placeholders = sanitizeEmailPlaceholderSettings(input.placeholders || {});
  const sanitized = templates
    .map((template = {}) => {
        const fulfillmentStatus = String(template.fulfillmentStatus || template.status || "").trim();
        const fulfillmentKey = normalizeOrderStatus(fulfillmentStatus);
        const templateContext = emailTemplateContext(template);
        const translations = {};
        const inputTranslations = template.translations && typeof template.translations === "object" ? template.translations : {};
        for (const lang of ["el"]) {
          const entry = inputTranslations[lang] && typeof inputTranslations[lang] === "object" ? inputTranslations[lang] : {};
          const subject = String(entry.subject || "").trim().slice(0, 180);
          const body = String(entry.body || "").trim().slice(0, 5000);
          if (subject && body) translations[lang] = { subject, body };
        }
        return {
          enabled: template.enabled !== false,
          templateContext,
          context: templateContext,
          fulfillmentStatus,
          fulfillmentKey,
          status: fulfillmentStatus,
          statusKey: fulfillmentKey,
          subject: String(template.subject || "").trim().slice(0, 180),
          body: String(template.body || "").trim().slice(0, 5000),
          translations,
        };
      })
    .filter(template => template.fulfillmentStatus && template.fulfillmentKey && template.subject && template.body);

  const merged = includeDefaults ? [...sanitized] : sanitized;
  if (includeDefaults) {
    for (const template of defaultOrderEmailSettings().templates) {
      const existing = merged.find(item => item.fulfillmentKey === template.fulfillmentKey && item.templateContext === template.templateContext);
      if (!existing) {
        merged.push(template);
      } else {
        existing.translations = { ...(template.translations || {}), ...(existing.translations || {}) };
      }
    }
  }

  return {
    placeholders,
    templates: merged.slice(0, 50),
    updatedAt: now(),
  };
}

async function getOrderEmailSettings() {
  const snap = await db.doc(ORDER_EMAIL_SETTINGS_DOC).get();
  if (!snap.exists) return defaultOrderEmailSettings();
  return sanitizeOrderEmailSettings(snap.data() || {});
}

function orderStatusTemplateVars(order = {}, previousStatus = "", previousFulfillmentStatus = previousStatus, placeholdersInput = {}) {
  const customer = order.customer || {};
  const shipping = order.shipping || {};
  const boxNow = shipping.boxNow || {};
  const language = String(order.language || order.locale || "en").trim().toLowerCase() === "el" ? "el" : "en";
  const placeholders = sanitizeEmailPlaceholderSettings(placeholdersInput || {});
  const customerName = String(customer.name || "").trim();
  const greetingTemplate = customerName ? placeholders.greeting[language] : placeholders.greetingNoName[language];
  return {
    orderNumber: publicOrderId(order),
    greeting: greetingTemplate.replace(/\{customerName\}/g, customerName),
    customerName,
    customerEmail: customer.email || "",
    customerPhone: customer.phone || "",
    status: order.status || "",
    previousStatus,
    fulfillmentStatus: order.fulfillmentStatus || "",
    previousFulfillmentStatus,
    trackingNumber: shipping.trackingNumber || "",
    trackingUrl: shipping.trackingUrl || boxNowTrackingUrl(shipping.trackingNumber || order.boxNowShipment?.parcelIds?.[0] || ""),
    total: formatMoney(order.amountTotal, order.currency),
    coupon: order.couponCode || order.metadata?.couponCode || "",
    grubz_url: GRUBZ_URL,
    feedback_url: String(order.feedbackUrl || order.feedback_url || "").trim(),
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

function renderOrderTemplateHtml(value, vars) {
  const html = String(value || "").replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    const replacement = vars[key] == null ? "" : String(vars[key]);
    const escaped = escapeHtml(replacement);
    if (key === "feedback_url" && /^https?:\/\//i.test(replacement)) {
      return `<a href="${escaped}" style="color:#92400e;font-weight:700;">${escaped}</a>`;
    }
    return key === "coupon" && escaped ? `<strong>${escaped}</strong>` : escaped;
  });
  return html.replace(/\n/g, "<br>\n");
}

function templateContentForLanguage(template = {}, language = "en") {
	const lang = normalizeOrderLanguage(language);
  const translated = lang !== "en" ? template.translations?.[lang] : null;
  return {
    subject: translated?.subject || template.subject || "",
    body: translated?.body || template.body || "",
  };
}

function buildOrderStatusEmail(template, order, previousStatus, previousFulfillmentStatus = previousStatus, settings = {}) {
  const vars = orderStatusTemplateVars(order, previousStatus, previousFulfillmentStatus, settings.placeholders);
	const content = templateContentForLanguage(template, resolveOrderLanguage(order));
  const subject = renderOrderTemplate(content.subject, vars);
  const text = renderOrderTemplate(content.body, vars);
  return { subject, text, html: renderOrderTemplateHtml(content.body, vars) };
}

function sampleOrderForStatusTemplate(fulfillmentStatus, language = "en") {
  return {
    id: "test-order",
    orderNumber: "GRZ-TEST-123456",
    status: "paid",
    fulfillmentStatus: fulfillmentStatus || "processing",
    language: String(language || "en").trim().toLowerCase() === "el" ? "el" : "en",
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

async function sendOrderStatusTestEmail(template, adminUser = {}, language = "en", placeholdersInput = null) {
  const sanitized = sanitizeOrderEmailSettings({ templates: [template] }).templates[0];
  if (!sanitized) throw new Error("Enter a valid email template before sending a test.");
  const emailLanguage = String(language || "en").trim().toLowerCase() === "el" ? "el" : "en";
  const from = secretValue(ORDER_NOTIFICATION_FROM, defaultNotificationFrom());
  const savedSettings = await getOrderEmailSettings();
  const settings = {
    ...savedSettings,
    placeholders: placeholdersInput
      ? sanitizeEmailPlaceholderSettings(placeholdersInput, savedSettings.placeholders)
      : savedSettings.placeholders,
  };
  const message = buildOrderStatusEmail(
    sanitized,
    sampleOrderForStatusTemplate(sanitized.fulfillmentStatus, emailLanguage),
    "paid",
    "previous_fulfillment",
    settings
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
    language: emailLanguage,
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

async function sendEmail({ to, from, bcc, subject, text, html, attachments }) {
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

  logger.info("Sending email", {
    to,
    bcc: bcc || "",
    from,
    subject,
  });
  const info = await smtpTransporter.sendMail({
    from,
    to,
    bcc,
    subject,
    text: signedText,
    html: signedHtml,
    attachments,
  });
  return {
    messageId: info.messageId || "",
    accepted: info.accepted || [],
    rejected: info.rejected || [],
  };
}

async function sendOrderNotificationOnce(type, order, event, recipientOverride = "") {
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
    const to = String(recipientOverride || "").trim() || secretValue(ORDER_NOTIFICATION_EMAIL, DEFAULT_NOTIFICATION_EMAIL);
    const from = secretValue(ORDER_NOTIFICATION_FROM, defaultNotificationFrom());
    const message = buildOrderNotification(type, order, event);
    const result = await sendEmail({ to, from, ...message });
    await notificationRef.set({
      status: result.skipped ? "skipped" : "sent",
      subject: message.subject || "",
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
      subject: message.subject || "",
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

async function resolveOrderCustomerEmail(order = {}) {
  const directEmail = normalizedEmail(
    order.customer?.email ||
    order.customerEmail ||
    order.email ||
    order.receiptEmail ||
    order.shipping?.email ||
    ""
  );
  if (directEmail) return directEmail;

  const uid = String(order.uid || order.customer?.uid || "").trim();
  if (uid && uid !== "guest" && !uid.includes("/")) {
    const snap = await db.collection("users").doc(uid).get();
    if (snap.exists) {
      const user = snap.data() || {};
      const userEmail = normalizedEmail(user.email || user.emailLower || "");
      if (userEmail) return userEmail;
    }
  }

  return "";
}

async function sendOrderStatusEmailOnce(order, previousFulfillmentStatus = "") {
  const fulfillmentKey = normalizeOrderStatus(order.fulfillmentStatus);
  const previousFulfillmentKey = normalizeOrderStatus(previousFulfillmentStatus);
  if (!fulfillmentKey || fulfillmentKey === previousFulfillmentKey) {
    return { skipped: true, reason: "fulfillment_unchanged" };
  }

  const customerEmail = await resolveOrderCustomerEmail(order);
  if (!customerEmail) {
    return { skipped: true, reason: "missing_customer_email" };
  }
  const recipientEmail = customerEmail;
  const bccEmail = GRUBZ_INFO_EMAIL;

  const settings = await getOrderEmailSettings();
  const template = settings.templates.find(item => item.enabled !== false && item.templateContext !== "customer" && item.fulfillmentKey === fulfillmentKey);
  if (!template) {
    return { skipped: true, reason: "missing_template" };
  }
	const content = templateContentForLanguage(template, resolveOrderLanguage(order));
  const orderCouponCode = normalizeCouponCode(order.couponCode || order.coupon || order.metadata?.couponCode || order.metadata?.coupon || "");
  if (containsCouponPlaceholder(content.body) && !orderCouponCode) {
    throw Object.assign(new Error("This fulfillment template uses {coupon}, but the order has no coupon code. Remove the placeholder before sending."), { status: 400 });
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
    const message = buildOrderStatusEmail(template, order, order.status || "", previousFulfillmentStatus, settings);
    const result = await sendEmail({ to: recipientEmail, from, bcc: bccEmail, ...message });
    await notificationRef.set({
      status: result.skipped ? "skipped" : "sent",
      subject: message.subject || "",
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

async function sendBoxNowFulfillmentEmailOnce(order, previousFulfillmentStatus = "", eventId = "") {
  const fulfillmentKey = normalizeOrderStatus(order.fulfillmentStatus);
  const orderId = String(order.id || publicOrderId(order) || "").trim();
  if (!orderId || !["shipped", "delivered"].includes(fulfillmentKey)) {
    return { skipped: true, reason: "unsupported_boxnow_fulfillment" };
  }

  const notificationRef = db.collection("orderNotifications").doc(
    `boxnow_fulfillment_${orderStatusDocKey(orderId)}_${orderStatusDocKey(fulfillmentKey)}`
  );
  const claimed = await db.runTransaction(async transaction => {
    const existing = await transaction.get(notificationRef);
    if (existing.exists) return false;
    transaction.set(notificationRef, {
      type: "boxnow_fulfillment_automatic",
      orderId,
      orderNumber: publicOrderId(order),
      fulfillmentStatus: fulfillmentKey,
      previousFulfillmentStatus,
      language: resolveOrderLanguage(order),
      webhookEventId: eventId,
      status: "sending",
      createdAt: now(),
      updatedAt: now(),
    });
    return true;
  });
  if (!claimed) return { skipped: true, reason: "boxnow_fulfillment_email_already_processed" };

  try {
    const result = await sendOrderStatusEmailOnce(order, previousFulfillmentStatus);
    await notificationRef.set({
      status: result?.skipped ? "skipped" : "sent",
      result: result || {},
      sentAt: result?.skipped ? null : now(),
      updatedAt: now(),
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

function feedbackCustomerKey(email = "") {
  return createHash("sha256").update(normalizedEmail(email)).digest("hex");
}

function feedbackCouponCode() {
  return `THANKS10-${randomUUID().replace(/-/g, "").slice(0, 10).toUpperCase()}`;
}

function feedbackThankYouMessage(feedback = {}, couponCode = "") {
  const greek = feedback.language === "el";
  const testOnly = feedback.testOnly === true;
  const expiry = couponDateMillis(feedback.couponEndsAt);
  const expiryText = expiry
    ? new Intl.DateTimeFormat(greek ? "el-GR" : "en-GB", { dateStyle: "long", timeZone: "Europe/Athens" }).format(new Date(expiry))
    : "";
  const shopUrl = `${GRUBZ_URL}/?coupon=${encodeURIComponent(couponCode)}#products`;
  const subjectBase = greek ? "Ευχαριστούμε για την αξιολόγησή σου – έκπτωση 10%" : "Thank you for your feedback – your 10% discount";
  const subject = testOnly ? `[TEST] ${subjectBase}` : subjectBase;
  const baseText = greek
    ? `Σε ευχαριστούμε για την αξιολόγησή σου.\n\nΟ μοναδικός κωδικός έκπτωσης 10% για την επόμενη παραγγελία σου είναι: ${couponCode}\n\nΟ κωδικός μπορεί να χρησιμοποιηθεί μία φορά${expiryText ? ` έως ${expiryText}` : ""} και συνδέεται με αυτή τη διεύθυνση email.\n\nΑγορές: ${shopUrl}`
    : `Thank you for your feedback.\n\nYour unique 10% discount code for your next order is: ${couponCode}\n\nThe code can be used once${expiryText ? ` until ${expiryText}` : ""} and is linked to this email address.\n\nShop: ${shopUrl}`;
  const testNote = greek
    ? "\n\nΔΟΚΙΜΗ: Ο κωδικός λειτουργεί μόνο για το info@grubz.gr. Σε Stripe live mode η κάρτα θα χρεωθεί κανονικά."
    : "\n\nTEST: This code works only for info@grubz.gr. In Stripe live mode, the card will be charged normally.";
  const text = `${baseText}${testOnly ? testNote : ""}`;
  const html = textToBasicHtml(text)
    .replace(escapeHtml(couponCode), `<strong style="font-size:18px;letter-spacing:0.04em;">${escapeHtml(couponCode)}</strong>`)
    .replace(escapeHtml(shopUrl), `<a href="${escapeHtml(shopUrl)}" style="font-weight:700;color:#c2410c;">${greek ? "Αγόρασε προϊόντα GRUBZ" : "Shop GRUBZ products"}</a>`);
  return { subject, text, html };
}

function ensureFeedbackIncentiveMessage(message = {}, language = "en") {
  if (/10\s*%/.test(`${message.subject || ""}\n${message.text || ""}`)) return message;
  const greek = language === "el";
  const note = greek
    ? "Μετά την υποβολή, θα λάβεις με email έναν μοναδικό κωδικό έκπτωσης 10% για την επόμενη παραγγελία σου. Ο σύνδεσμος λήγει σε 30 ημέρες."
    : "After submitting, you will receive a unique 10% discount code by email for your next order. This link expires in 30 days.";
  return {
    ...message,
    text: `${message.text || ""}\n\n${note}`,
    html: `${message.html || textToBasicHtml(message.text || "")}<p>${escapeHtml(note)}</p>`,
  };
}

async function sendFeedbackThankYouEmail(feedbackRef, feedback, couponCode) {
  const recipientEmail = feedback.testOnly ? GRUBZ_INFO_EMAIL : feedback.customerEmail;
  const message = feedbackThankYouMessage(feedback, couponCode);
  try {
    const result = await sendEmail({
      to: recipientEmail,
      from: secretValue(ORDER_NOTIFICATION_FROM, defaultNotificationFrom()),
      ...message,
    });
    await feedbackRef.set({
      thankYouEmailStatus: result.skipped ? "skipped" : "sent",
      thankYouEmailSentAt: result.skipped ? null : now(),
      thankYouEmailResult: result,
      updatedAt: now(),
    }, { merge: true });
    return result;
  } catch (err) {
    await feedbackRef.set({ thankYouEmailStatus: "failed", thankYouEmailError: err.message || "Email failed", updatedAt: now() }, { merge: true });
    throw err;
  }
}

async function sendOrderFeedbackEmail(order, adminUser = {}, options = {}) {
  const customerEmail = await resolveOrderCustomerEmail(order);
  if (!customerEmail) {
    throw Object.assign(new Error("This order has no customer email address."), { status: 400 });
  }
  const settings = await getOrderEmailSettings();
  const template = settings.templates.find(item =>
    item.enabled !== false &&
    item.templateContext === "feedback" &&
    item.fulfillmentKey === "feedback_request"
  );
  if (!template) {
    throw Object.assign(new Error("The feedback request email template is missing or disabled."), { status: 400 });
  }
  const orderId = order.id || publicOrderId(order);
  const testOnly = options.testOnly === true;
  const recipientEmail = testOnly ? GRUBZ_INFO_EMAIL : customerEmail;
  const bccEmail = !testOnly && options.includeMonitoringBcc !== false ? GRUBZ_INFO_EMAIL : "";
  const feedbackToken = randomUUID();
  const feedbackRef = db.collection(ORDER_FEEDBACK_COLLECTION).doc(createHash("sha256").update(feedbackToken).digest("hex"));
  const customerKey = feedbackCustomerKey(customerEmail);
  if (!testOnly) {
    const priorFeedback = await db.collection(ORDER_FEEDBACK_COLLECTION).where("customerEmail", "==", customerEmail).limit(20).get();
    if (priorFeedback.docs.some(doc => ["pending", "submitted"].includes(String(doc.data()?.status || "")) && doc.data()?.testOnly !== true)) {
      return { skipped: true, reason: "customer_already_invited" };
    }
    const claimRef = db.collection(FEEDBACK_CUSTOMERS_COLLECTION).doc(customerKey);
    const claimed = await db.runTransaction(async transaction => {
      const claim = await transaction.get(claimRef);
      if (claim.exists && ["pending", "submitted"].includes(String(claim.data()?.status || ""))) return false;
      transaction.set(claimRef, { customerEmail, feedbackId: feedbackRef.id, orderId, status: "pending", createdAt: now(), updatedAt: now() });
      return true;
    });
    if (!claimed) return { skipped: true, reason: "customer_already_invited" };
  }
  const feedbackBaseUrl = String(options.feedbackBaseUrl || GRUBZ_URL).replace(/\/$/, "");
  const feedbackUrl = `${feedbackBaseUrl}/feedback/?token=${encodeURIComponent(feedbackToken)}`;
  await feedbackRef.set({
    orderId,
    orderNumber: publicOrderId(order),
    customerName: String(order.customer?.name || order.shipping?.name || "").trim().slice(0, 180),
    customerEmail,
    recipientEmail,
    customerKey,
    testOnly,
    language: String(order.language || order.locale || "en").toLowerCase() === "el" ? "el" : "en",
    status: "pending",
    createdAt: now(),
    expiresAt: Timestamp.fromMillis(Date.now() + FEEDBACK_LINK_LIFETIME_DAYS * 24 * 60 * 60 * 1000),
    createdBy: adminUser.uid || "",
  });
  const notificationRef = db.collection("orderNotifications").doc(`order_feedback_${orderStatusDocKey(orderId)}_${Date.now()}`);
  await notificationRef.set({
    type: testOnly ? "order_feedback_request_test" : "order_feedback_request",
    orderId,
    orderNumber: publicOrderId(order),
    customerEmail,
    recipientEmail,
    bccEmail,
    testOnly,
    status: "sending",
    createdAt: now(),
    createdBy: adminUser.uid || "",
  });
  try {
    const from = secretValue(ORDER_NOTIFICATION_FROM, defaultNotificationFrom());
    const language = String(order.language || order.locale || "en").toLowerCase() === "el" ? "el" : "en";
    const message = ensureFeedbackIncentiveMessage(
      buildOrderStatusEmail(template, { ...order, feedbackUrl }, order.status || "", order.fulfillmentStatus || "", settings),
      language
    );
    const result = await sendEmail({
      to: recipientEmail,
      ...(bccEmail ? { bcc: bccEmail } : {}),
      from,
      ...message,
    });
    await notificationRef.set({
      status: result.skipped ? "skipped" : "sent",
      subject: message.subject || "",
      result,
      updatedAt: now(),
      sentAt: result.skipped ? null : now(),
    }, { merge: true });
    if (result.skipped && !testOnly) {
      await db.collection(FEEDBACK_CUSTOMERS_COLLECTION).doc(customerKey).delete().catch(() => {});
      await feedbackRef.set({ status: "delivery_failed", updatedAt: now() }, { merge: true });
    }
    if (!result.skipped && !testOnly) {
      await db.collection("orders").doc(orderId).set({
        feedbackEmailSentAt: now(),
        feedbackEmailSentBy: adminUser.uid || "",
        feedbackEmailSendCount: FieldValue.increment(1),
        updatedAt: now(),
      }, { merge: true });
    }
    return { ...result, ...(testOnly ? { feedbackUrl } : {}) };
  } catch (err) {
    if (!testOnly) {
      await db.collection(FEEDBACK_CUSTOMERS_COLLECTION).doc(customerKey).delete().catch(() => {});
    }
    await notificationRef.set({
      status: "failed",
      error: err.message || "Email failed",
      updatedAt: now(),
    }, { merge: true });
    throw err;
  }
}

async function sendOrderLockerReminderEmail(order, adminUser = {}) {
  const customerEmail = await resolveOrderCustomerEmail(order);
  if (!customerEmail) {
    throw Object.assign(new Error("This order has no customer email address."), { status: 400 });
  }
  const locker = order.shipping?.boxNow || order.boxNow || {};
  if (!String(locker.name || locker.id || "").trim()) {
    throw Object.assign(new Error("This order has no BOX NOW locker information."), { status: 400 });
  }
  const settings = await getOrderEmailSettings();
  const template = settings.templates.find(item =>
    item.enabled !== false &&
    item.templateContext === "order" &&
    item.fulfillmentKey === "locker_reminder"
  );
  if (!template) {
    throw Object.assign(new Error("The BOX NOW locker reminder template is missing or disabled."), { status: 400 });
  }
  const orderId = order.id || publicOrderId(order);
  const notificationRef = db.collection("orderNotifications").doc(`order_locker_reminder_${orderStatusDocKey(orderId)}_${Date.now()}`);
  await notificationRef.set({
    type: "order_locker_reminder",
    orderId,
    orderNumber: publicOrderId(order),
    customerEmail,
    recipientEmail: customerEmail,
    bccEmail: GRUBZ_INFO_EMAIL,
    status: "sending",
    createdAt: now(),
    createdBy: adminUser.uid || "",
  });
  try {
    const from = secretValue(ORDER_NOTIFICATION_FROM, defaultNotificationFrom());
    const reminderOrder = {
      ...order,
      shipping: {
        ...(order.shipping || {}),
        boxNow: order.shipping?.boxNow || order.boxNow || {},
      },
    };
    const message = buildOrderStatusEmail(template, reminderOrder, order.status || "", order.fulfillmentStatus || "", settings);
    const result = await sendEmail({ to: customerEmail, from, bcc: GRUBZ_INFO_EMAIL, ...message });
    await notificationRef.set({
      status: result.skipped ? "skipped" : "sent",
      subject: message.subject || "",
      result,
      updatedAt: now(),
      sentAt: result.skipped ? null : now(),
    }, { merge: true });
    if (!result.skipped) {
      await db.collection("orders").doc(orderId).set({
        lockerReminderEmailSentAt: now(),
        lockerReminderEmailSentBy: adminUser.uid || "",
        lockerReminderEmailSendCount: FieldValue.increment(1),
        updatedAt: now(),
      }, { merge: true });
    }
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

async function sendBoxNowLockerArrivalEmail(order, parcelId = "") {
  const customerEmail = await resolveOrderCustomerEmail(order);
  if (!customerEmail) return { skipped: true, reason: "missing_customer_email" };
  const settings = await getOrderEmailSettings();
  const template = settings.templates.find(item =>
    item.enabled !== false && item.templateContext === "order" && item.fulfillmentKey === "locker_arrival"
  );
  if (!template) return { skipped: true, reason: "missing_template" };

  const orderId = order.id || publicOrderId(order);
  const notificationRef = db.collection("orderNotifications").doc(
    `order_boxnow_locker_arrival_${orderStatusDocKey(orderId)}_${orderStatusDocKey(parcelId || "parcel")}`
  );
  const existing = await notificationRef.get();
  if (existing.exists && ["sending", "sent"].includes(String(existing.data()?.status || ""))) {
    return { skipped: true, reason: "already_sent" };
  }
  await notificationRef.set({
    type: "order_boxnow_locker_arrival",
    orderId,
    orderNumber: publicOrderId(order),
    parcelId,
    customerEmail,
    recipientEmail: customerEmail,
    bccEmail: GRUBZ_INFO_EMAIL,
    status: "sending",
    createdAt: existing.exists ? existing.data()?.createdAt || now() : now(),
    lastAttemptAt: now(),
    createdBy: "boxnow_webhook",
  }, { merge: true });

  try {
    const message = buildOrderStatusEmail(template, order, order.status || "", order.fulfillmentStatus || "", settings);
    const result = await sendEmail({
      to: customerEmail,
      from: secretValue(ORDER_NOTIFICATION_FROM, defaultNotificationFrom()),
      bcc: GRUBZ_INFO_EMAIL,
      ...message,
    });
    await notificationRef.set({
      status: result.skipped ? "skipped" : "sent",
      subject: message.subject || "",
      result,
      sentAt: result.skipped ? null : now(),
      updatedAt: now(),
    }, { merge: true });
    return result;
  } catch (err) {
    await notificationRef.set({ status: "failed", error: err.message || "Email failed", updatedAt: now() }, { merge: true });
    throw err;
  }
}

async function scheduleAutomaticBoxNowLockerReminder(order, eventRecord = {}) {
  const orderId = order.id || publicOrderId(order);
  const parcelId = String(eventRecord.parcelId || "").trim();
  const ref = db.collection(SCHEDULED_ORDER_EMAILS_COLLECTION).doc(
    `boxnow_locker_reminder_${orderStatusDocKey(orderId)}_${orderStatusDocKey(parcelId || "parcel")}`
  );
  const existing = await ref.get();
  if (existing.exists && ["pending", "sending", "sent"].includes(String(existing.data()?.status || ""))) {
    return { skipped: true, reason: "already_scheduled", id: ref.id };
  }
  const eventMs = millisFromTimestamp(eventRecord.eventTime) || Date.now();
  const sendAt = new Date(Math.max(Date.now() + 5 * 60 * 1000, eventMs + 18 * 60 * 60 * 1000));
  await ref.set({
    orderId,
    orderNumber: publicOrderId(order),
    parcelId,
    type: "locker_reminder",
    automaticBoxNow: true,
    status: "pending",
    scheduledAt: Timestamp.fromDate(sendAt),
    createdAt: existing.exists ? existing.data()?.createdAt || now() : now(),
    updatedAt: now(),
    createdBy: "boxnow_webhook",
  }, { merge: true });
  return { id: ref.id, scheduledAt: Timestamp.fromDate(sendAt) };
}

async function cancelAutomaticBoxNowLockerReminder(orderId, parcelId, event = "") {
  const ref = db.collection(SCHEDULED_ORDER_EMAILS_COLLECTION).doc(
    `boxnow_locker_reminder_${orderStatusDocKey(orderId)}_${orderStatusDocKey(parcelId || "parcel")}`
  );
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.status !== "pending") return { skipped: true };
  await ref.set({ status: "cancelled", cancelReason: event || "parcel_no_longer_waiting", cancelledAt: now(), updatedAt: now() }, { merge: true });
  return { cancelled: true };
}

async function scheduleOrderEmail(order, type, sendAtInput, adminUser = {}, previousFulfillmentStatus = "") {
  const allowedTypes = new Set(["fulfillment", "feedback", "locker_reminder"]);
  if (!allowedTypes.has(type)) throw Object.assign(new Error("Unknown scheduled email type."), { status: 400 });
  const sendAt = new Date(String(sendAtInput || ""));
  if (Number.isNaN(sendAt.getTime()) || sendAt.getTime() <= Date.now()) {
    throw Object.assign(new Error("Choose a future date and time."), { status: 400 });
  }
  if (sendAt.getTime() > Date.now() + 366 * 24 * 60 * 60 * 1000) {
    throw Object.assign(new Error("Emails can be scheduled up to one year ahead."), { status: 400 });
  }
  const ref = db.collection(SCHEDULED_ORDER_EMAILS_COLLECTION).doc();
  await ref.set({
    orderId: order.id || publicOrderId(order),
    orderNumber: publicOrderId(order),
    type,
    previousFulfillmentStatus: String(previousFulfillmentStatus || ""),
    fulfillmentStatus: String(order.fulfillmentStatus || ""),
    status: "pending",
    scheduledAt: Timestamp.fromDate(sendAt),
    createdAt: now(),
    createdBy: adminUser.uid || "",
  });
  return { id: ref.id, scheduledAt: Timestamp.fromDate(sendAt), type };
}

exports.sendScheduledOrderEmails = onSchedule(
  {
    region: "europe-west1",
    schedule: "every 5 minutes",
    timeZone: "Europe/Athens",
    secrets: [SMTP_USER, SMTP_PASS, ORDER_NOTIFICATION_FROM],
  },
  async () => {
    const snap = await db.collection(SCHEDULED_ORDER_EMAILS_COLLECTION)
      .where("status", "==", "pending")
      .limit(500)
      .get();
    const dueJobs = snap.docs
      .filter(doc => doc.data().scheduledAt?.toMillis?.() <= Date.now())
      .sort((a, b) => a.data().scheduledAt.toMillis() - b.data().scheduledAt.toMillis())
      .slice(0, 50);
    for (const jobDoc of dueJobs) {
      const claimed = await db.runTransaction(async transaction => {
        const current = await transaction.get(jobDoc.ref);
        if (!current.exists || current.data().status !== "pending") return false;
        transaction.update(jobDoc.ref, { status: "sending", startedAt: now(), updatedAt: now() });
        return true;
      });
      if (!claimed) continue;
      const job = jobDoc.data();
      try {
        const orderSnap = await db.collection("orders").doc(job.orderId).get();
        if (!orderSnap.exists) throw new Error("Order not found");
        const order = { id: orderSnap.id, ...orderSnap.data() };
        if (job.type === "locker_reminder" && job.automaticBoxNow === true) {
          const parcelKey = orderStatusDocKey(job.parcelId || "unknown");
          const latestEvent = normalizeOrderStatus(order.boxNowShipment?.parcelEvents?.[parcelKey]?.event).replace(/[_\s]+/g, "-");
          const review = order.boxNowNotificationReview || {};
          const approved = review.status === "approved" && String(review.parcelId || "") === String(job.parcelId || "");
          if (latestEvent !== "final-destination" || !approved) {
            const cancelReason = latestEvent !== "final-destination" ? `parcel_event_${latestEvent || "unknown"}` : "approval_missing";
            await jobDoc.ref.set({ status: "cancelled", cancelReason, cancelledAt: now(), updatedAt: now() }, { merge: true });
            continue;
          }
        }
        let result;
        if (job.type === "feedback") result = await sendOrderFeedbackEmail(order, { uid: job.createdBy || "scheduler" });
        else if (job.type === "locker_reminder") result = await sendOrderLockerReminderEmail(order, { uid: job.createdBy || "scheduler" });
        else result = await sendOrderStatusEmailOnce(order, job.previousFulfillmentStatus || "");
        await jobDoc.ref.set({ status: result?.skipped ? "skipped" : "sent", result: result || {}, sentAt: now(), updatedAt: now() }, { merge: true });
      } catch (err) {
        logger.error("Scheduled order email failed", { jobId: jobDoc.id, orderId: job.orderId, error: err.message });
        await jobDoc.ref.set({ status: "failed", error: err.message || "Email failed", updatedAt: now() }, { merge: true });
      }
    }
  }
);

exports.orderFeedback = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    secrets: [SMTP_USER, SMTP_PASS, ORDER_NOTIFICATION_FROM],
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      const token = String(req.query.token || req.body?.token || "").trim();
      if (!token) return jsonError(res, 400, "Missing feedback link.");
      const ref = db.collection(ORDER_FEEDBACK_COLLECTION).doc(createHash("sha256").update(token).digest("hex"));
      const snap = await ref.get();
      if (!snap.exists) return jsonError(res, 404, "This feedback link is invalid.");
      const feedback = snap.data() || {};
      if (req.method === "GET") {
        const expired = feedback.status !== "submitted" && couponDateMillis(feedback.expiresAt) > 0 && couponDateMillis(feedback.expiresAt) < Date.now();
        if (expired) return jsonError(res, 410, "This feedback link has expired.");
        return res.json({
          ok: true,
          orderNumber: feedback.orderNumber || "",
          customerName: feedback.customerName || "",
          language: feedback.language || "en",
          submitted: feedback.status === "submitted",
        });
      }
      if (req.method !== "POST") return jsonError(res, 405, "Use GET or POST.");
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const rating = Math.round(Number(body.rating || 0));
      if (rating < 1 || rating > 5) return jsonError(res, 400, "Choose a rating from 1 to 5.");
      const comment = String(body.comment || "").trim().slice(0, 2000);
      const couponCode = feedbackCouponCode();
      const couponEndsAt = Timestamp.fromMillis(Date.now() + FEEDBACK_COUPON_LIFETIME_DAYS * 24 * 60 * 60 * 1000);
      const couponRef = db.collection(COUPONS_COLLECTION).doc(couponDocId(couponCode));
      const committedFeedback = await db.runTransaction(async transaction => {
        const currentSnap = await transaction.get(ref);
        if (!currentSnap.exists) throw Object.assign(new Error("This feedback link is invalid."), { status: 404 });
        const current = currentSnap.data() || {};
        if (current.status === "submitted") throw Object.assign(new Error("Feedback has already been submitted."), { status: 409 });
        if (couponDateMillis(current.expiresAt) > 0 && couponDateMillis(current.expiresAt) < Date.now()) {
          throw Object.assign(new Error("This feedback link has expired."), { status: 410 });
        }
        const coupon = {
          code: couponCode,
          active: true,
          type: "percent",
          percentOff: 10,
          amountOffCents: 0,
          currency: "eur",
          minimumSubtotalCents: 0,
          maxRedemptions: 1,
          maxRedemptionsPerCustomer: 1,
          redemptionCount: 0,
          allowedProductIds: [],
          startsAt: now(),
          endsAt: couponEndsAt,
          assignedEmail: current.testOnly === true ? GRUBZ_INFO_EMAIL : normalizedEmail(current.customerEmail || ""),
          testOnly: current.testOnly === true,
          source: "feedback_reward",
          feedbackId: ref.id,
          description: current.testOnly ? "TEST feedback reward (info@grubz.gr only)" : "10% feedback thank-you reward",
          createdAt: now(),
          updatedAt: now(),
        };
        transaction.create(couponRef, coupon);
        transaction.set(ref, {
          rating,
          comment,
          status: "submitted",
          couponCode,
          couponEndsAt,
          couponId: couponRef.id,
          thankYouEmailStatus: "pending",
          submittedAt: now(),
          updatedAt: now(),
        }, { merge: true });
        if (!current.testOnly && current.customerKey) {
          transaction.set(db.collection(FEEDBACK_CUSTOMERS_COLLECTION).doc(current.customerKey), {
            status: "submitted", feedbackId: ref.id, couponCode, submittedAt: now(), updatedAt: now(),
          }, { merge: true });
        }
        return { ...current, couponEndsAt };
      });
      if (feedback.orderId && committedFeedback.testOnly !== true) {
        await db.collection("orders").doc(feedback.orderId).set({
          customerFeedback: {
            rating,
            comment,
            submittedAt: now(),
          },
          updatedAt: now(),
        }, { merge: true });
      }
      let thankYouEmail = { skipped: true, reason: "not_attempted" };
      try {
        thankYouEmail = await sendFeedbackThankYouEmail(ref, committedFeedback, couponCode);
      } catch (emailError) {
        logger.error("Feedback thank-you email failed", { feedbackId: ref.id, error: emailError.message || "Email failed" });
        thankYouEmail = { failed: true, error: emailError.message || "Email failed" };
      }
      return res.json({ ok: true, thankYouEmailSent: !thankYouEmail.skipped && !thankYouEmail.failed });
    } catch (err) {
      logger.error("Order feedback failed", { error: err.message || "Order feedback failed" });
      return jsonError(res, Number(err.status || 400), err.message || "Feedback could not be saved.");
    }
  }
);

async function feedbackBulkEligibility() {
  const [ordersSnap, claimsSnap, feedbackSnap] = await Promise.all([
    db.collection("orders").orderBy("createdAt", "desc").limit(1000).get(),
    db.collection(FEEDBACK_CUSTOMERS_COLLECTION).limit(1000).get(),
    db.collection(ORDER_FEEDBACK_COLLECTION).orderBy("createdAt", "desc").limit(1000).get(),
  ]);
  const claimed = new Map(claimsSnap.docs.map(doc => [doc.id, doc.data() || {}]));
  for (const doc of feedbackSnap.docs) {
    const row = doc.data() || {};
    if (row.testOnly === true) continue;
    const email = normalizedEmail(row.customerEmail || "");
    if (!email) continue;
    const key = feedbackCustomerKey(email);
    const existing = claimed.get(key);
    if (!existing || row.status === "submitted") claimed.set(key, { status: row.status || "pending", feedbackId: doc.id });
  }
  const customers = new Map();
  const counts = { deliveredOrders: 0, eligible: 0, alreadyInvited: 0, alreadySubmitted: 0, missingEmail: 0, duplicateCustomers: 0 };
  for (const doc of ordersSnap.docs) {
    const order = { id: doc.id, ...doc.data() };
    if (normalizeOrderStatus(order.fulfillmentStatus) !== "delivered" || String(order.status || "").toLowerCase() === "cancelled") continue;
    counts.deliveredOrders += 1;
    const email = await resolveOrderCustomerEmail(order);
    if (!email || !validEmailAddress(email)) { counts.missingEmail += 1; continue; }
    const key = feedbackCustomerKey(email);
    if (customers.has(key)) { counts.duplicateCustomers += 1; continue; }
    const claim = claimed.get(key);
    if (claim?.status === "submitted") { counts.alreadySubmitted += 1; continue; }
    if (claim?.status === "pending") { counts.alreadyInvited += 1; continue; }
    customers.set(key, order);
  }
  counts.eligible = customers.size;
  return { counts, orders: [...customers.values()] };
}

async function sendBulkFeedbackRequests(adminUser, { testOnly = false, feedbackBaseUrl = GRUBZ_URL } = {}) {
  const eligibility = await feedbackBulkEligibility();
  let selectedOrders = eligibility.orders.slice(0, 250);
  if (testOnly) {
    const snap = await db.collection("orders").orderBy("createdAt", "desc").limit(250).get();
    selectedOrders = [];
    for (const doc of snap.docs) {
      const order = { id: doc.id, ...doc.data() };
      if (normalizeOrderStatus(order.fulfillmentStatus) !== "delivered" || String(order.status || "").toLowerCase() === "cancelled") continue;
      const email = await resolveOrderCustomerEmail(order);
      if (email && validEmailAddress(email)) { selectedOrders = [order]; break; }
    }
  }
  if (!selectedOrders.length) throw Object.assign(new Error("No eligible delivered customers were found."), { status: 400 });
  const results = [];
  let monitoringBccSent = false;
  for (const order of selectedOrders) {
    try {
      const result = await sendOrderFeedbackEmail(order, adminUser, {
        testOnly,
        feedbackBaseUrl,
        includeMonitoringBcc: !testOnly && !monitoringBccSent,
      });
      if (!testOnly && !result.skipped && !monitoringBccSent) monitoringBccSent = true;
      results.push({ orderId: order.id, email: await resolveOrderCustomerEmail(order), ok: !result.skipped, ...result });
    } catch (err) {
      results.push({ orderId: order.id, email: await resolveOrderCustomerEmail(order), ok: false, error: err.message || "Email failed" });
    }
  }
  return {
    testOnly,
    attempted: results.length,
    sent: results.filter(item => item.ok).length,
    skipped: results.filter(item => item.skipped).length,
    failed: results.filter(item => !item.ok && !item.skipped).length,
    remainingEligible: testOnly ? eligibility.counts.eligible : Math.max(0, eligibility.counts.eligible - selectedOrders.length),
    results,
  };
}

exports.adminFeedback = onRequest(
  { region: "europe-west1", invoker: "public", secrets: [SMTP_USER, SMTP_PASS, ORDER_NOTIFICATION_FROM], cors: ALLOWED_ORIGIN_LIST },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      const adminUser = await requireAdmin(req);
      if (req.method === "GET") {
        const snap = await db.collection(ORDER_FEEDBACK_COLLECTION).orderBy("createdAt", "desc").limit(500).get();
        const feedback = snap.docs.map(doc => {
          const row = doc.data() || {};
          return {
            id: doc.id,
            orderId: row.orderId || "",
            orderNumber: row.orderNumber || "",
            customerName: row.customerName || "",
            customerEmail: row.customerEmail || "",
            language: row.language || "en",
            testOnly: row.testOnly === true,
            status: row.status || "pending",
            rating: Number(row.rating || 0),
            comment: row.comment || "",
            reviewed: row.reviewed === true,
            internalNote: row.internalNote || "",
            createdAt: row.createdAt || null,
            submittedAt: row.submittedAt || null,
            couponCode: row.couponCode || "",
            couponEndsAt: row.couponEndsAt || null,
            thankYouEmailStatus: row.thankYouEmailStatus || "",
            reviewedAt: row.reviewedAt || null,
            reviewedBy: row.reviewedBy || "",
          };
        });
        const productionFeedback = feedback.filter(row => row.testOnly !== true);
        const submitted = productionFeedback.filter(row => row.status === "submitted" && row.rating > 0);
        const distribution = [1, 2, 3, 4, 5].map(rating => ({
          rating,
          count: submitted.filter(row => row.rating === rating).length,
        }));
        const average = submitted.length
          ? submitted.reduce((sum, row) => sum + row.rating, 0) / submitted.length
          : 0;
        return res.json({
          ok: true,
          feedback,
          summary: {
            requests: productionFeedback.length,
            responses: submitted.length,
            awaitingReview: submitted.filter(row => !row.reviewed).length,
            averageRating: Number(average.toFixed(2)),
            responseRate: productionFeedback.length ? Number(((submitted.length / productionFeedback.length) * 100).toFixed(1)) : 0,
            distribution,
          },
        });
      }
      if (req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const action = String(body.action || "").trim();
        if (action === "previewBulk") {
          const eligibility = await feedbackBulkEligibility();
          return res.json({ ok: true, counts: eligibility.counts, sample: eligibility.orders.slice(0, 10).map(order => ({
            orderId: order.id, orderNumber: publicOrderId(order), customerName: order.customer?.name || order.shipping?.name || "", customerEmail: order.customer?.email || "",
          })) });
        }
        if (action === "sendBulk") return res.json({ ok: true, ...(await sendBulkFeedbackRequests(adminUser)) });
        if (action === "sendBulkTest") {
          const origin = String(req.headers.origin || "").trim();
          const feedbackBaseUrl = isLocalRequest(req) && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ? origin : GRUBZ_URL;
          return res.json({ ok: true, ...(await sendBulkFeedbackRequests(adminUser, { testOnly: true, feedbackBaseUrl })) });
        }
        if (action === "retryThankYouEmail") {
          const id = String(body.id || "").trim();
          if (!id || id.includes("/")) return jsonError(res, 400, "Missing feedback ID.");
          const feedbackRef = db.collection(ORDER_FEEDBACK_COLLECTION).doc(id);
          const feedbackSnap = await feedbackRef.get();
          if (!feedbackSnap.exists) return jsonError(res, 404, "Feedback not found.");
          const row = feedbackSnap.data() || {};
          if (row.status !== "submitted" || !row.couponCode) return jsonError(res, 400, "This feedback has no reward email to retry.");
          const result = await sendFeedbackThankYouEmail(feedbackRef, row, row.couponCode);
          return res.json({ ok: true, result });
        }
        return jsonError(res, 400, "Unknown feedback action.");
      }
      if (req.method === "PATCH") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const id = String(body.id || "").trim();
        if (!id || id.includes("/")) return jsonError(res, 400, "Missing feedback ID.");
        const ref = db.collection(ORDER_FEEDBACK_COLLECTION).doc(id);
        const snap = await ref.get();
        if (!snap.exists) return jsonError(res, 404, "Feedback not found.");
        const existing = snap.data() || {};
        const reviewed = body.reviewed === true;
        const update = {
          reviewed,
          internalNote: String(body.internalNote || "").trim().slice(0, 2000),
          reviewedAt: reviewed ? now() : null,
          reviewedBy: reviewed ? adminUser.uid || "" : "",
          updatedAt: now(),
        };
        await ref.set(update, { merge: true });
        if (existing.orderId && existing.testOnly !== true) {
          await db.collection("orders").doc(existing.orderId).update({
            "customerFeedback.reviewed": reviewed,
            "customerFeedback.internalNote": update.internalNote,
            "customerFeedback.reviewedAt": update.reviewedAt,
            updatedAt: now(),
          });
        }
        return res.json({ ok: true });
      }
      if (req.method === "DELETE") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const id = String(req.query.id || body.id || "").trim();
        if (!id || id.includes("/")) return jsonError(res, 400, "Missing feedback ID.");
        const ref = db.collection(ORDER_FEEDBACK_COLLECTION).doc(id);
        const snap = await ref.get();
        if (!snap.exists) return jsonError(res, 404, "Feedback not found.");
        const existing = snap.data() || {};
        await ref.delete();
        if (existing.testOnly === true && existing.couponId) {
          await db.collection(COUPONS_COLLECTION).doc(existing.couponId).delete().catch(() => {});
        }
        if (existing.testOnly !== true && existing.customerKey && existing.status !== "submitted") {
          await db.collection(FEEDBACK_CUSTOMERS_COLLECTION).doc(existing.customerKey).delete().catch(() => {});
        }
        if (existing.status === "submitted" && existing.orderId && existing.testOnly !== true) {
          const orderRef = db.collection("orders").doc(existing.orderId);
          const orderSnap = await orderRef.get();
          if (orderSnap.exists) {
            const storedFeedback = orderSnap.data()?.customerFeedback || {};
            const storedSubmittedAt = millisFromTimestamp(storedFeedback.submittedAt);
            const deletedSubmittedAt = millisFromTimestamp(existing.submittedAt);
            if (!storedSubmittedAt || !deletedSubmittedAt || storedSubmittedAt === deletedSubmittedAt) {
              await orderRef.set({ customerFeedback: FieldValue.delete(), updatedAt: now() }, { merge: true });
            }
          }
        }
        logger.info("Admin deleted customer feedback", { feedbackId: id, orderId: existing.orderId || "", adminUid: adminUser.uid || "" });
        return res.json({ ok: true });
      }
      return jsonError(res, 405, "Use GET, POST, PATCH, or DELETE.");
    } catch (err) {
      return adminError(res, err);
    }
  }
);

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

      // Stripe Checkout session IDs identify their environment. The success
      // page is always hosted on production, including checkouts created by a
      // local storefront, so request origin cannot safely select the key here.
      const stripeMode = sid.startsWith("cs_test_") ? "test" : "live";
      const stripeSecret = stripeSecretForMode(stripeMode);
      if (!stripeSecret) throw new Error(`Stripe ${stripeMode} secret is not configured`);
      const stripe = stripeClient(stripeSecret);
      const session = await stripe.checkout.sessions.retrieve(sid);

      if (session?.metadata?.uid && session.metadata.uid !== "guest" && !uid) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      if (session?.metadata?.uid && session.metadata.uid !== "guest" && session.metadata.uid !== uid) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const paid =
        session?.status === "complete" && session?.payment_status === "paid";

      const order = paid ? await upsertOrderFromSession(session) : null;

      return res.json({
        paid,
        orderNumber: order?.orderNumber || session?.metadata?.orderNumber || "",
        amount_total: session?.amount_total || null,
        currency: session?.currency || null,
        inventoryState: order?.inventoryState || (paid ? "reserved" : "none"),
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
    webhookEnvironment: "stage",
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
    webhookEnvironment: sanitizeBoxNowEnvironment(settings.webhookEnvironment || "stage"),
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
    webhookEnvironment: sanitizeBoxNowEnvironment(stored.webhookEnvironment || defaults.webhookEnvironment),
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
  const webhookEnvironment = sanitizeBoxNowEnvironment(input.webhookEnvironment || existing.webhookEnvironment || "stage");
  const settings = {
    activeEnvironment,
    webhookEnvironment,
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

function boxNowDeliveryErrorMessage(response) {
  const code = String(response?.data?.code || "").trim();
  if (code === "P405" || code === "C404") {
    return "BOX NOW delivery request failed (400/P405): Invalid phone number. BOX NOW requires the sender and recipient phone numbers in full international format, for example +30 69 1234 5678.";
  }
  if (code === "P411") {
    return "BOX NOW delivery request failed (400/P411): This BOX NOW account is not eligible for Cash-on-delivery. Select Prepaid as the BOX NOW shipping type, or ask BOX NOW to enable COD for these API credentials.";
  }
  return `BOX NOW delivery request failed (${response.status}): ${JSON.stringify(response.data || {})}`;
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
  if (result.layout) compact.layout = result.layout;
  if (result.buffer) {
    compact.size = result.buffer.length;
    compact.base64 = result.buffer.toString("base64");
  }
  return compact;
}

function boxNowTrackingUrl(parcelId = "") {
  const id = String(parcelId || "").trim();
  return id ? `https://track.boxnow.gr/en?track=${encodeURIComponent(id)}` : "";
}

function normalizeBoxNowPhone(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  let compact = raw.replace(/[()\s.-]+/g, "");
  if (compact.startsWith("00")) compact = `+${compact.slice(2)}`;
  compact = compact.replace(/(?!^\+)[^\d]/g, "");
  if (compact.startsWith("+")) return `+${compact.slice(1).replace(/\D/g, "")}`;
  const digits = compact.replace(/\D/g, "");
  if (/^30\d{10}$/.test(digits)) return `+${digits}`;
  if (/^\d{10}$/.test(digits)) return `+30${digits}`;
  return digits ? `+${digits}` : raw;
}

function boxNowParcelItemsForOrder(order, productsMap = PRODUCTS_MAP, compartmentSizeOverride = null) {
  const cartItems = (Array.isArray(order.items) ? order.items : []).map(item => ({
    id: item.id,
    qty: Math.max(1, Number(item.quantity || item.qty || 1)),
  }));
  const parcel = calculateBoxNowParcel(cartItems, productsMap);
  const parcelSizes = Array.isArray(parcel.parcels) && parcel.parcels.length ? parcel.parcels : [parcel];
  const requestedCompartmentSize = Number(compartmentSizeOverride);
  const hasCompartmentOverride = [2, 3].includes(requestedCompartmentSize);
  const subtotal = Math.max(0, Number(order.amountSubtotal || orderItemsSubtotal(order)));
  const valuePerParcel = parcelSizes.length ? subtotal / parcelSizes.length / 100 : 0;
  const weightPerParcel = parcelSizes.length ? Math.max(1, Math.round(Number(parcel.weightGrams || order.boxnowFee?.weightGrams || 0) / parcelSizes.length)) : 0;
  return parcelSizes.map((size, index) => {
    const calculatedCompartmentSize = Number(size.code || parcel.code || 2);
    const compartmentSize = hasCompartmentOverride ? requestedCompartmentSize : calculatedCompartmentSize;
    return {
      id: `${publicOrderId(order)}-${index + 1}`,
      name: `${publicOrderId(order)} parcel ${index + 1}`,
      value: valuePerParcel.toFixed(2),
      weight: weightPerParcel,
      // GRUBZ does not use Small compartments, even if stale data calculates size 1.
      compartmentSize: compartmentSize === 3 ? 3 : 2,
    };
  });
}

function boxNowDestinationEmailFromOrder(order = {}) {
  return normalizedEmail(
    order.shipping?.email ||
    order.customer?.email ||
    order.customerEmail ||
    order.email ||
    order.receiptEmail ||
    ""
  );
}

async function resolveBoxNowDestinationEmail(order = {}) {
  const orderEmail = boxNowDestinationEmailFromOrder(order);
  if (orderEmail) return orderEmail;

  const uid = String(order.uid || order.customer?.uid || "").trim();
  if (uid && uid !== "guest" && !uid.includes("/")) {
    const userSnap = await db.collection("users").doc(uid).get();
    if (userSnap.exists) {
      const user = userSnap.data() || {};
      const userEmail = normalizedEmail(user.email || user.emailLower || "");
      if (userEmail) return userEmail;
    }
  }

  return GRUBZ_INFO_EMAIL;
}

function buildBoxNowDeliveryRequest(order, config, productsMap = PRODUCTS_MAP, options = {}) {
  const orderNumber = publicOrderId(order);
  const shipping = order.shipping || {};
  const boxNow = shipping.boxNow || {};
  if (!orderNumber) throw new Error("Order is missing an order number");
  if (!boxNow.id) throw new Error("Order is missing a BOX NOW locker ID");
  if (!config.originLocationId) throw new Error(`Set the ${config.environment} BOX NOW origin location ID first`);
  if (!config.originContactNumber) throw new Error(`Set the ${config.environment} BOX NOW origin contact phone first`);

  const customer = order.customer || {};
  const originPhone = normalizeBoxNowPhone(config.originContactNumber);
  const destinationPhone = normalizeBoxNowPhone(shipping.phone || customer.phone || "");
  const destinationEmail = normalizedEmail(options.destinationEmail || boxNowDestinationEmailFromOrder(order) || GRUBZ_INFO_EMAIL);
  if (!destinationPhone) throw new Error("Order is missing the recipient phone number");

  const requestedPaymentMode = String(options.paymentMode || "").trim().toLowerCase();
  const isCod = requestedPaymentMode
    ? requestedPaymentMode === "cod"
    : order.paymentMethod === "cash_on_delivery" || shipping.cashOnDelivery === true;
  const totalCents = Math.max(0, Number(order.amountDue || order.amountTotal || 0));
  const amountToBeCollectedCents = isCod
    ? Math.max(0, Number.isFinite(Number(options.amountToBeCollectedCents))
      ? Number(options.amountToBeCollectedCents)
      : totalCents)
    : 0;
  const destinationLocationId = config.environment === "stage"
    ? BOXNOW_STAGE_TEST_DESTINATION_LOCATION_ID
    : String(boxNow.id);
  const stageDestinationOverride = config.environment === "stage"
    ? { requestedLocationId: String(boxNow.id), stageTestLocationId: destinationLocationId }
    : null;
  return {
    orderNumber,
    invoiceValue: (Math.max(0, Number(order.amountSubtotal || 0)) / 100).toFixed(2),
    paymentMode: isCod ? "cod" : "prepaid",
    amountToBeCollected: isCod ? (amountToBeCollectedCents / 100).toFixed(2) : "0.00",
    origin: {
      contactNumber: originPhone,
      contactEmail: config.originContactEmail || GRUBZ_INFO_EMAIL,
      contactName: config.originContactName || "GRUBZ",
      locationId: String(config.originLocationId),
    },
    destination: {
      contactNumber: destinationPhone,
      contactEmail: destinationEmail,
      contactName: customer.name || shipping.name || "GRUBZ Customer",
      locationId: destinationLocationId,
      ...(stageDestinationOverride ? { stageDestinationOverride } : {}),
    },
    items: boxNowParcelItemsForOrder(order, productsMap, options.compartmentSize),
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

  const settings = await getEffectiveBoxNowSettings(options.req || null, {
    includeSecrets: true,
    forceLocalEnvironment: false,
  });
  const orderEnvironment = order.boxnowFee?.environment || order.boxNowFee?.environment || "";
  const config = boxNowEnvConfig(settings, options.environment || orderEnvironment || settings.activeEnvironment);
  const productsMap = await getProductsMap({ includeInactive: true });
  const destinationEmail = await resolveBoxNowDestinationEmail(order);
  const payload = buildBoxNowDeliveryRequest(order, config, productsMap, {
    paymentMode: options.paymentMode || "",
    compartmentSize: options.compartmentSize,
    amountToBeCollectedCents: options.amountToBeCollectedCents,
    destinationEmail,
  });
  const { token } = await getBoxNowAccessToken(config);
  const response = await boxNowApiRequest(config, "/api/v1/delivery-requests", {
    method: "POST",
    token,
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    console.error("BOX NOW delivery request rejected", {
      orderId,
      environment: config.environment,
      status: response.status,
      response: response.data || {},
      request: payload,
    });
    const err = new Error(boxNowDeliveryErrorMessage(response));
    err.details = { status: response.status, response: response.data || {}, request: payload };
    throw err;
  }

  const parcels = Array.isArray(response.data?.parcels) ? response.data.parcels : [];
  const parcelIds = parcels.map(parcel => String(parcel.id || parcel.parcelId || "")).filter(Boolean);
  const deliveryRequestId = String(response.data?.id || response.data?.deliveryRequestId || publicOrderId(order));
  const deliveryRequestIds = [
    response.data?.id,
    response.data?.deliveryRequestId,
    response.data?.deliveryRequest?.id,
    response.data?.data?.id,
    response.data?.data?.deliveryRequestId,
    publicOrderId(order),
  ].map(value => String(value || "").trim()).filter(Boolean);
  const firstParcelId = parcelIds[0] || "";
  const trackingUrl = boxNowTrackingUrl(firstParcelId);
  const update = {
    boxNowShipment: {
      environment: config.environment,
      deliveryRequestId,
      deliveryRequestIds,
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
      trackingUrl: trackingUrl || order.shipping?.trackingUrl || "",
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

function flattenedBagCapacityKg(parcel = {}) {
  const configuredCapacity = Number(parcel.capacityKg);
  if (Number.isFinite(configuredCapacity) && configuredCapacity > 0) return configuredCapacity;
  const fitsOneKgBag =
    Number(parcel.heightCm || 0) >= BOXNOW_MIN_FLATTENED_BAG_COMPARTMENT_HEIGHT_CM &&
    Number(parcel.widthCm || 0) >= ONE_KG_FLEXIBLE_BAG_PARCEL.widthCm &&
    Number(parcel.lengthCm || 0) >= ONE_KG_FLEXIBLE_BAG_PARCEL.lengthCm;
  return fitsOneKgBag ? BOXNOW_FLATTENED_BAGS_PER_COMPARTMENT : 0;
}

function flattenedBagRequiredHeightCm(weightGrams = 0) {
  const kgUnits = Math.ceil(Math.max(0, Number(weightGrams || 0)) / 1000);
  const compartments = Math.ceil(kgUnits / BOXNOW_FLATTENED_BAGS_PER_COMPARTMENT);
  return compartments * BOXNOW_MIN_FLATTENED_BAG_COMPARTMENT_HEIGHT_CM;
}

function boxNowParcelSizesWithPrices(shippingSettings = {}) {
  const prices = shippingSettings.boxnowParcelPrices && typeof shippingSettings.boxnowParcelPrices === "object"
    ? shippingSettings.boxnowParcelPrices
    : {};
  return BOXNOW_PARCEL_SIZES.map(parcel => {
    const customAmount = prices[parcel.code] ?? prices[String(parcel.label || "").toLowerCase()];
    const amount = Math.max(0, Math.round(Number(customAmount ?? parcel.amount)));
    return { ...parcel, amount: Number.isFinite(amount) ? amount : parcel.amount };
  });
}

function cheapestParcelCombinationForWeight(weightGrams = 0, parcelSizes = BOXNOW_PARCEL_SIZES) {
  const kgUnits = Math.max(1, Math.ceil(Math.max(0, Number(weightGrams || 0)) / 1000));
  const maxParcels = kgUnits;
  let best = null;

  for (let small = 0; small <= maxParcels; small += 1) {
    for (let medium = 0; medium <= maxParcels; medium += 1) {
      for (let large = 0; large <= maxParcels; large += 1) {
        const parcels = [
          ...Array.from({ length: small }, () => parcelSizes[0]),
          ...Array.from({ length: medium }, () => parcelSizes[1]),
          ...Array.from({ length: large }, () => parcelSizes[2]),
        ];
        if (!parcels.length) continue;
        const capacityKg = parcels.reduce((sum, parcel) => sum + flattenedBagCapacityKg(parcel), 0);
        if (capacityKg < kgUnits) continue;
        const amount = parcels.reduce((sum, parcel) => sum + parcel.amount, 0);
        const count = parcels.length;
        const capacityHeightCm = parcels.reduce((sum, parcel) => sum + parcel.heightCm, 0);
        if (
          best &&
          (count > best.count ||
            (count === best.count && amount > best.amount) ||
            (count === best.count && amount === best.amount && capacityKg >= best.capacityKg))
        ) {
          continue;
        }
        best = { parcels, amount, count, capacityKg, capacityHeightCm };
      }
    }
  }

  return best?.parcels || [parcelSizes[parcelSizes.length - 1]];
}

function expandParcelItems(items, productsMap = PRODUCTS_MAP) {
  return normalizeCartItems(items, productsMap).flatMap(({ id, qty, product }) => {
    const dimensions = productParcelDimensions(product, id);
    return Array.from({ length: qty }, () => ({
      id,
      heightCm: dimensions.heightCm,
      widthCm: dimensions.widthCm,
      lengthCm: dimensions.lengthCm,
    }));
  });
}

function packingOrientationsForParcel(item, parcel) {
  const dimensions = [
    Number(item.heightCm || 0),
    Number(item.widthCm || 0),
    Number(item.lengthCm || 0),
  ].filter(Boolean);
  const orientations = [];
  const seen = new Set();
  for (let verticalIndex = 0; verticalIndex < dimensions.length; verticalIndex += 1) {
    const verticalCm = dimensions[verticalIndex];
    const base = dimensions.filter((_, index) => index !== verticalIndex);
    const variants = [
      { widthCm: base[0], lengthCm: base[1] },
      { widthCm: base[1], lengthCm: base[0] },
    ];
    for (const variant of variants) {
      const key = `${verticalCm}:${variant.widthCm}:${variant.lengthCm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (
        verticalCm <= Number(parcel.heightCm || 0) &&
        variant.widthCm <= Number(parcel.widthCm || 0) &&
        variant.lengthCm <= Number(parcel.lengthCm || 0)
      ) {
        orientations.push({ verticalCm, widthCm: variant.widthCm, lengthCm: variant.lengthCm });
      }
    }
  }
  return orientations.sort((a, b) => a.verticalCm - b.verticalCm);
}

function packageFitsParcel(item, parcel) {
  return packingOrientationsForParcel(item, parcel).length > 0;
}

function rectsFitInBase(rects, widthCm, lengthCm) {
  if (!rects.length) return true;
  const ordered = [...rects].sort((a, b) => (b.widthCm * b.lengthCm) - (a.widthCm * a.lengthCm));
  function place(index, spaces) {
    if (index >= ordered.length) return true;
    const rect = ordered[index];
    const variants = [
      { widthCm: rect.widthCm, lengthCm: rect.lengthCm },
      { widthCm: rect.lengthCm, lengthCm: rect.widthCm },
    ];
    for (let spaceIndex = 0; spaceIndex < spaces.length; spaceIndex += 1) {
      const space = spaces[spaceIndex];
      for (const variant of variants) {
        if (variant.widthCm > space.widthCm || variant.lengthCm > space.lengthCm) continue;
        const nextSpaces = [
          ...spaces.slice(0, spaceIndex),
          ...spaces.slice(spaceIndex + 1),
          {
            x: space.x + variant.widthCm,
            y: space.y,
            widthCm: space.widthCm - variant.widthCm,
            lengthCm: variant.lengthCm,
          },
          {
            x: space.x,
            y: space.y + variant.lengthCm,
            widthCm: space.widthCm,
            lengthCm: space.lengthCm - variant.lengthCm,
          },
        ].filter(spaceItem => spaceItem.widthCm > 0 && spaceItem.lengthCm > 0);
        if (place(index + 1, nextSpaces)) return true;
      }
    }
    return false;
  }
  return place(0, [{ x: 0, y: 0, widthCm, lengthCm }]);
}

function itemsFitSingleLayerInParcel(items, parcel) {
  const orientedItems = [];
  function choose(index) {
    if (index >= items.length) {
      return rectsFitInBase(orientedItems, Number(parcel.widthCm || 0), Number(parcel.lengthCm || 0));
    }
    for (const orientation of packingOrientationsForParcel(items[index], parcel)) {
      orientedItems.push({ widthCm: orientation.widthCm, lengthCm: orientation.lengthCm });
      if (choose(index + 1)) return true;
      orientedItems.pop();
    }
    return false;
  }
  return choose(0);
}

function itemsFitStackedInParcel(items, parcel) {
  const chosen = [];
  function choose(index) {
    if (index >= items.length) {
      const totalHeight = chosen.reduce((sum, item) => sum + item.verticalCm, 0);
      const maxWidth = chosen.reduce((max, item) => Math.max(max, item.widthCm), 0);
      const maxLength = chosen.reduce((max, item) => Math.max(max, item.lengthCm), 0);
      return totalHeight <= Number(parcel.heightCm || 0) &&
        ((maxWidth <= Number(parcel.widthCm || 0) && maxLength <= Number(parcel.lengthCm || 0)) ||
          (maxLength <= Number(parcel.widthCm || 0) && maxWidth <= Number(parcel.lengthCm || 0)));
    }
    for (const orientation of packingOrientationsForParcel(items[index], parcel)) {
      chosen.push(orientation);
      if (choose(index + 1)) return true;
      chosen.pop();
    }
    return false;
  }
  return choose(0);
}

function itemsFitInParcel(items, parcel) {
  return itemsFitSingleLayerInParcel(items, parcel) || itemsFitStackedInParcel(items, parcel);
}

function canPackItemsInParcels(items, parcels) {
  const available = parcels.map(parcel => ({ ...parcel, items: [] }));
  const orderedItems = [...items].sort((a, b) => {
    const aVolume = Number(a.heightCm || 0) * Number(a.widthCm || 0) * Number(a.lengthCm || 0);
    const bVolume = Number(b.heightCm || 0) * Number(b.widthCm || 0) * Number(b.lengthCm || 0);
    return bVolume - aVolume;
  });
  if (orderedItems.some(item => !available.some(parcel => packageFitsParcel(item, parcel)))) {
    return false;
  }
  function place(index) {
    if (index >= orderedItems.length) return true;
    const item = orderedItems[index];
    const seen = new Set();
    for (let i = 0; i < available.length; i += 1) {
      const parcel = available[i];
      const key = `${parcel.code}:${parcel.items.length}:${parcel.items.map(placed => placed.id || "").join("|")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parcel.items.push(item);
      if (itemsFitInParcel(parcel.items, parcel) && place(index + 1)) return true;
      parcel.items.pop();
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

function cheapestParcelCombination(items) {
  if (!items.length) return [];
  const maxParcels = Math.max(1, items.length);
  let best = null;

  for (let small = 0; small <= maxParcels; small += 1) {
    for (let medium = 0; medium <= maxParcels; medium += 1) {
      for (let large = 0; large <= maxParcels; large += 1) {
        const parcels = [
          ...Array.from({ length: small }, () => BOXNOW_PARCEL_SIZES[0]),
          ...Array.from({ length: medium }, () => BOXNOW_PARCEL_SIZES[1]),
          ...Array.from({ length: large }, () => BOXNOW_PARCEL_SIZES[2]),
        ];
        if (!parcels.length) continue;
        const capacity = parcels.reduce((sum, parcel) => sum + parcel.heightCm, 0);
        const amount = parcels.reduce((sum, parcel) => sum + parcel.amount, 0);
        const count = parcels.length;
        if (
          best &&
          (count > best.count ||
            (count === best.count && amount > best.amount) ||
            (count === best.count && amount === best.amount && capacity >= best.capacity))
        ) {
          continue;
        }
        if (!canPackItemsInParcels(items, parcels)) continue;
        best = { parcels, amount, count, capacity };
      }
    }
  }

  return best?.parcels || [BOXNOW_PARCEL_SIZES[BOXNOW_PARCEL_SIZES.length - 1]];
}

function calculateBoxNowParcel(items, productsMap = PRODUCTS_MAP, parcelSizes = BOXNOW_PARCEL_SIZES) {
  const weightGrams = cartWeightGrams(items, productsMap);
  const kgUnits = Math.max(1, Math.ceil(Math.max(0, weightGrams) / 1000));
  const parcels = cheapestParcelCombinationForWeight(weightGrams, parcelSizes);
  const largestParcel = parcels.reduce((largest, parcel) => {
    return parcel.heightCm > largest.heightCm ? parcel : largest;
  }, parcels[0] || parcelSizes[parcelSizes.length - 1]);
  const amount = parcels.reduce((sum, parcel) => sum + parcel.amount, 0);
  const capacityHeightCm = parcels.reduce((sum, parcel) => sum + parcel.heightCm, 0);
  const capacityKg = parcels.reduce((sum, parcel) => sum + flattenedBagCapacityKg(parcel), 0);

  return {
    code: largestParcel.code,
    label: parcelCombinationLabel(parcels) || largestParcel.label,
    amount,
    weightGrams,
    kgUnits,
    capacityKg,
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
    requiredHeightCm: Math.ceil(flattenedBagRequiredHeightCm(weightGrams) * 10) / 10,
    maxItemWidthCm: ONE_KG_FLEXIBLE_BAG_PARCEL.widthCm,
    maxItemLengthCm: ONE_KG_FLEXIBLE_BAG_PARCEL.lengthCm,
    oversized: capacityKg < kgUnits,
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

async function calculateBoxNowFee(items, shipping, productsMap = PRODUCTS_MAP, boxNowConfig = null) {
  const weightGrams = cartWeightGrams(items, productsMap);
  const environment = boxNowConfig?.environment || "";
  const apiBaseUrl = boxNowConfig?.apiBaseUrl || "";
  const shippingSettings = await getShippingSettings();
  const parcelSizes = boxNowParcelSizesWithPrices(shippingSettings);
  const parcel = calculateBoxNowParcel(items, productsMap, parcelSizes);
  const baseAmount = shippingSettings.boxnowFeeOverrideEnabled
    ? shippingSettings.boxnowFeeOverrideCents
    : parcel.amount;
  const discountCents = shippingSettings.boxnowFeeDiscountEnabled
    ? Math.min(baseAmount, shippingSettings.boxnowFeeDiscountCents)
    : 0;

  return {
    amount: Math.max(0, baseAmount - discountCents),
    baseAmount,
    discountCents,
    currency: "eur",
    source: shippingSettings.boxnowFeeOverrideEnabled ? "admin-override" : "admin-parcel-prices",
    discountSource: discountCents > 0 ? "admin-discount" : "",
    weightGrams,
    parcel,
    environment,
    apiBaseUrl,
  };
}

function sanitizeShippingSettings(input = {}) {
  const overrideEnabled = input.boxnowFeeOverrideEnabled === true;
  const rawCents = input.boxnowFeeOverrideCents ?? input.boxnowFeeOverrideAmountCents ?? null;
  const amount = rawCents === "" || rawCents == null ? 0 : Math.round(Number(rawCents));
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Invalid BOX NOW override amount");
  const discountEnabled = input.boxnowFeeDiscountEnabled === true;
  const rawDiscountCents = input.boxnowFeeDiscountCents ?? input.boxnowFeeDiscountAmountCents ?? null;
  const discountAmount = rawDiscountCents === "" || rawDiscountCents == null ? 0 : Math.round(Number(rawDiscountCents));
  if (!Number.isFinite(discountAmount) || discountAmount < 0) throw new Error("Invalid BOX NOW discount amount");
  const inputPrices = input.boxnowParcelPrices && typeof input.boxnowParcelPrices === "object" ? input.boxnowParcelPrices : {};
  const boxnowParcelPrices = {};
  for (const parcel of BOXNOW_PARCEL_SIZES) {
    const raw = inputPrices[parcel.code] ?? inputPrices[String(parcel.label || "").toLowerCase()] ?? parcel.amount;
    const cents = Math.max(0, Math.round(Number(raw)));
    if (!Number.isFinite(cents)) throw new Error(`Invalid BOX NOW ${parcel.label} price`);
    boxnowParcelPrices[parcel.code] = cents;
  }
  return {
    boxnowFeeOverrideEnabled: overrideEnabled,
    boxnowFeeOverrideCents: amount,
    boxnowFeeDiscountEnabled: discountEnabled,
    boxnowFeeDiscountCents: discountAmount,
    boxnowParcelPrices,
    updatedAt: now(),
  };
}

async function getShippingSettings() {
  const snap = await db.doc(SHIPPING_SETTINGS_DOC).get();
  if (!snap.exists) {
    return {
      boxnowFeeOverrideEnabled: false,
      boxnowFeeOverrideCents: 0,
      boxnowFeeDiscountEnabled: false,
      boxnowFeeDiscountCents: 0,
      boxnowParcelPrices: Object.fromEntries(BOXNOW_PARCEL_SIZES.map(parcel => [parcel.code, parcel.amount])),
    };
  }
  const data = snap.data() || {};
  const savedPrices = data.boxnowParcelPrices && typeof data.boxnowParcelPrices === "object" ? data.boxnowParcelPrices : {};
  return {
    boxnowFeeOverrideEnabled: data.boxnowFeeOverrideEnabled === true,
    boxnowFeeOverrideCents: Math.max(0, Math.round(Number(data.boxnowFeeOverrideCents || 0))),
    boxnowFeeDiscountEnabled: data.boxnowFeeDiscountEnabled === true,
    boxnowFeeDiscountCents: Math.max(0, Math.round(Number(data.boxnowFeeDiscountCents || 0))),
    boxnowParcelPrices: Object.fromEntries(BOXNOW_PARCEL_SIZES.map(parcel => {
      const amount = Math.max(0, Math.round(Number(savedPrices[parcel.code] ?? savedPrices[String(parcel.label || "").toLowerCase()] ?? parcel.amount)));
      return [parcel.code, Number.isFinite(amount) ? amount : parcel.amount];
    })),
  };
}

const DEFAULT_MARKETING_SETTINGS = {
  firstOrderOffer: {
    enabled: true,
    couponCode: "WELCOME10",
  },
};

function sanitizeMarketingSettings(input = {}, existing = {}) {
  const firstOrderInput = input.firstOrderOffer && typeof input.firstOrderOffer === "object" ? input.firstOrderOffer : {};
  const existingFirstOrder = existing.firstOrderOffer && typeof existing.firstOrderOffer === "object" ? existing.firstOrderOffer : {};
  const firstOrderOffer = {
    ...DEFAULT_MARKETING_SETTINGS.firstOrderOffer,
    ...existingFirstOrder,
    ...firstOrderInput,
  };
  return {
    firstOrderOffer: {
      enabled: firstOrderOffer.enabled !== false,
      couponCode: normalizeCouponCode(firstOrderOffer.couponCode || DEFAULT_MARKETING_SETTINGS.firstOrderOffer.couponCode).slice(0, 80),
    },
    updatedAt: now(),
  };
}

async function getMarketingSettings() {
  const snap = await db.doc(MARKETING_SETTINGS_DOC).get();
  const existing = snap.exists ? snap.data() : {};
  return sanitizeMarketingSettings(existing, DEFAULT_MARKETING_SETTINGS);
}

exports.getBoxNowFee = onRequest(
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
      if (req.method !== "POST") return jsonError(res, 405, "Use POST");

      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const items = Array.isArray(body.items) ? body.items : [];
      const shipping = body.shipping && typeof body.shipping === "object" ? body.shipping : null;

      if (!items.length) return jsonError(res, 400, "No items");
      if (!shipping?.boxNow?.id) return jsonError(res, 400, "Missing BOX NOW locker");

      const productsMap = await getProductsMap();
      const boxNowSettings = await getEffectiveBoxNowSettings(req, { includeSecrets: true, forceLocalEnvironment: false });
      const boxNowConfig = boxNowEnvConfig(boxNowSettings, boxNowSettings.activeEnvironment);
      const fee = await calculateBoxNowFee(items, shipping, productsMap, boxNowConfig);
      return res.json({ ok: true, ...fee });
    } catch (e) {
      logger.error("getBoxNowFee failed", e);
      return jsonError(res, 400, e.message || "BOX NOW fee unavailable");
    }
  }
);

exports.getShippingSettings = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method !== "GET") return jsonError(res, 405, "Use GET");

      const shipping = await getShippingSettings();
      const marketing = await getMarketingSettings();
      return res.json({
        ok: true,
        shipping: {
          boxnowFeeOverrideEnabled: shipping.boxnowFeeOverrideEnabled === true,
          boxnowFeeOverrideCents: Math.max(0, Number(shipping.boxnowFeeOverrideCents || 0)),
          boxnowFeeDiscountEnabled: shipping.boxnowFeeDiscountEnabled === true,
          boxnowFeeDiscountCents: Math.max(0, Number(shipping.boxnowFeeDiscountCents || 0)),
          boxnowParcelPrices: shipping.boxnowParcelPrices || {},
        },
        marketing: {
          firstOrderOffer: {
            enabled: marketing.firstOrderOffer?.enabled !== false,
            couponCode: marketing.firstOrderOffer?.couponCode || "",
          },
        },
      });
    } catch (e) {
      logger.error("getShippingSettings failed", e);
      return jsonError(res, 400, e.message || "Shipping settings unavailable");
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
      const referralCode = normalizeReferralCode(body.referralCode || body.referral || "");
      const attribution = normalizeOrderAttribution(body.attribution && typeof body.attribution === "object" ? body.attribution : {});
      const language = String(body.language || "").trim().toLowerCase() === "el" ? "el" : "en";
      const shipping = body.shipping && typeof body.shipping === "object" ? body.shipping : null;
      const deliveryMethod = String(shipping?.deliveryMethod || "boxnow").trim();
      const boxNow = shipping && shipping.boxNow && typeof shipping.boxNow === "object" ? shipping.boxNow : null;
      const cashOnDelivery = shipping?.cashOnDelivery === true;

      if (!items.length) return res.status(400).json({ error: "No items" });
      const shippingError = validateShipping(shipping);
      if (shippingError) return res.status(400).json({ error: shippingError });
      if (uid) {
        await persistCustomerShipping(uid, shipping, { email: authUser?.email || "" });
      }
      if (deliveryMethod === "courier_quote") {
        if (!uid || !authUser?.email) return res.status(401).json({ error: "Sign in is required to request a courier quote" });
        const productsMap = await getProductsMap();
        const order = await createCourierQuoteOrder({
          uid,
          email: authUser.email,
          items,
          shipping,
          couponCode,
          referralCode,
          attribution,
          productsMap,
          language,
        });
        await sendOrderNotificationOnce("courier_quote_order", order, { id: order.id, type: "courier_quote" }, GRUBZ_INFO_EMAIL);
        return res.status(200).json({
          ok: true,
          courierQuote: true,
          orderNumber: order.orderNumber,
          url: `/checkout/success?quote=1&order=${encodeURIComponent(order.orderNumber)}`,
        });
      }
      if (!String(boxNow?.id || "").trim()) {
        return res.status(400).json({ error: "Missing BOX NOW locker" });
      }
      const productsMap = await getProductsMap();
      const boxNowSettings = await getEffectiveBoxNowSettings(req, { includeSecrets: true, forceLocalEnvironment: false });
      const boxNowConfig = boxNowEnvConfig(boxNowSettings, boxNowSettings.activeEnvironment);

      if (cashOnDelivery) {
        if (!uid) return res.status(401).json({ error: "Sign in is required for cash on delivery" });
        const stripeConfig = await activeStripeConfig(req);
        const order = await createCashOnDeliveryOrder({
          uid,
          email: authUser?.email || "",
          items,
          shipping: { ...shipping, cashOnDelivery: true },
          couponCode,
          referralCode,
          attribution,
          productsMap,
          stripeMode: stripeConfig.mode,
          language,
          boxNowConfig,
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
        const availableStock = Number.isFinite(Number(p.stock)) ? Math.max(0, Number(p.stock)) : null;
        if (availableStock != null && quantity > availableStock && p.allowBackorder !== true) {
          throw new Error(availableStock > 0
            ? `Only ${availableStock} available for ${p.name || id}`
            : `${p.name || id} is out of stock`);
        }
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

      const boxNowFee = await calculateBoxNowFee(items, shipping, productsMap, boxNowConfig);
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
        shippingAddressLine1: String(shipping?.addressLine1 || shipping?.line1 || "").slice(0, 500),
        shippingAddressLine2: String(shipping?.addressLine2 || shipping?.line2 || "").slice(0, 500),
        shippingCity: String(shipping?.city || "").slice(0, 500),
        shippingRegion: String(shipping?.region || "").slice(0, 500),
        shippingPostalCode: String(shipping?.postalCode || shipping?.postal || "").slice(0, 500),
        shippingCountry: String(shipping?.country || "Greece").slice(0, 500),
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
        boxnowEnvironment: String(boxNowFee.environment || boxNowConfig.environment || "").slice(0, 500),
        boxnowApiBaseUrl: String(boxNowFee.apiBaseUrl || boxNowConfig.apiBaseUrl || "").slice(0, 500),
        couponCode: couponResult?.coupon?.code || "",
        couponId: couponResult?.coupon?.id || "",
        couponDiscountCents: String(couponResult?.discountCents || 0).slice(0, 500),
        referralCode,
        attributionSource: attribution.source,
        attributionMedium: attribution.medium,
        attributionCampaign: attribution.campaign,
        attributionContent: attribution.content,
        attributionTerm: attribution.term,
        attributionClickId: attribution.clickId,
        attributionLandingPage: attribution.landingPage,
        attributionReferrer: attribution.referrer,
        attributionSessionId: attribution.sessionId,
        language,
      };

      const requestOrigin = String(req.headers.origin || "").trim();
      const returnBase = isLocalRequest(req) && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(requestOrigin)
        ? requestOrigin
        : HOSTING_BASE;
      const params = {
        mode: "payment",
        locale: language,
        client_reference_id: orderNumber,
        line_items,
        automatic_tax: { enabled: false },
        success_url: `${returnBase}/checkout/success?sid={CHECKOUT_SESSION_ID}`,
        cancel_url: `${returnBase}/checkout/cancelled`,
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
        const inventoryPools = await getInventoryPools();
        const inventoryHistorySnap = await db.collection("inventoryTransactions").orderBy("createdAt", "desc").limit(50).get();
        const inventoryHistory = inventoryHistorySnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.json({ products, inventoryPools, inventoryHistory });
      }

      if (req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        if (String(body.action || "").trim() === "saveInventoryPool") {
          const input = body.pool && typeof body.pool === "object" ? body.pool : {};
          const id = String(input.id || "").trim().toLowerCase();
          if (!/^[a-z0-9][a-z0-9-]{1,80}$/.test(id)) return jsonError(res, 400, "Pool ID must use lowercase letters, numbers, and hyphens");
          const name = String(input.name || "").trim().slice(0, 120);
          if (!name) return jsonError(res, 400, "Pool name is required");
          const poolRef = db.collection("inventoryPools").doc(id);
          const existing = await poolRef.get();
          await poolRef.set({
            id,
            name,
            material: String(input.material || "").trim().slice(0, 240),
            active: input.active !== false,
            allowBackorder: input.allowBackorder === true,
            onHandGrams: existing.exists ? Math.max(0, Number(existing.data().onHandGrams || 0)) : 0,
            reservedGrams: existing.exists ? Math.max(0, Number(existing.data().reservedGrams || 0)) : 0,
            createdAt: existing.exists ? existing.data().createdAt || now() : now(),
            updatedAt: now(),
            updatedBy: adminUser.uid,
          }, { merge:true });
          return res.json({ ok:true, pool:inventoryPoolView(id, (await poolRef.get()).data()) });
        }
        if (String(body.action || "").trim() === "adjustInventory") {
          const poolId = String(body.poolId || "").trim();
          const poolCheck = await db.collection("inventoryPools").doc(poolId).get();
          if (!poolCheck.exists) return jsonError(res, 400, "Unknown inventory pool");
          const deltaGrams = Math.round(Number(body.deltaGrams || 0));
          if (!Number.isFinite(deltaGrams) || !deltaGrams) return jsonError(res, 400, "Enter a non-zero stock adjustment");
          const reason = String(body.reason || "Manual adjustment").trim().slice(0, 500);
          const poolRef = db.collection("inventoryPools").doc(poolId);
          const transactionRef = db.collection("inventoryTransactions").doc();
          let result;
          await db.runTransaction(async transaction => {
            const snap = await transaction.get(poolRef);
            const current = inventoryPoolView(poolId, snap.exists ? snap.data() : {});
            const onHandGrams = Math.max(0, current.onHandGrams + deltaGrams);
            const appliedDeltaGrams = onHandGrams - current.onHandGrams;
            transaction.set(poolRef, { onHandGrams, reservedGrams: current.reservedGrams, updatedAt: now(), updatedBy: adminUser.uid }, { merge: true });
            transaction.set(transactionRef, { poolId, type: "manual_adjustment", deltaGrams: appliedDeltaGrams, reason, createdAt: now(), createdBy: adminUser.uid });
            result = inventoryPoolView(poolId, { onHandGrams, reservedGrams: current.reservedGrams, updatedAt: now() });
          });
          return res.json({ ok: true, pool: result });
        }
        const product = sanitizeProductPayload(body.product || body);
        if (product.inventoryPoolId) {
          const poolSnap = await db.collection("inventoryPools").doc(product.inventoryPoolId).get();
          if (!poolSnap.exists) return jsonError(res, 400, "Selected inventory pool does not exist");
        }
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
    let step = "start";
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method !== "POST") return jsonError(res, 405, "Use POST");
      step = "auth";
      const adminUser = await requireAdmin(req);
      step = "parse_body";
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      step = "parse_image";
      const { id, contentType, buffer, ext } = parseImageUpload(body);

      step = "storage_upload";
      const upload = await saveProductImageToStorage({ id, contentType, buffer, ext });
      step = "firestore_update";
      await db.collection("products").doc(id).set({
        image: upload.image,
        updatedAt: now(),
        updatedBy: adminUser.uid,
      }, { merge: true });

      return res.json({ ok: true, image: upload.image, path: upload.path, bucket: upload.bucketName });
    } catch (err) {
      logger.error("adminProductImage failed", {
        step,
        message: err.message || "Product image upload failed",
        code: err.code || "",
      });
      const status = Number(err.status || 400);
      return jsonError(res, status, `${step}_failed: ${err.message || "Product image upload failed"}`);
    }
  }
);

exports.adminNewsletterImage = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method !== "POST") return jsonError(res, 405, "Use POST");
      await requireAdmin(req);
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const upload = parseImageUpload({ ...body, id: `newsletter-${Date.now()}` });
      const runningInEmulator = process.env.FUNCTIONS_EMULATOR === "true" || Boolean(
        String(process.env.FIREBASE_STORAGE_EMULATOR_HOST || process.env.STORAGE_EMULATOR_HOST || "").trim()
      );
      if (runningInEmulator && !process.env.K_SERVICE) {
        return res.json({
          ok: true,
          image: `data:${upload.contentType};base64,${upload.buffer.toString("base64")}`,
          inline: true,
        });
      }
      const stored = await saveProductImageToStorage(upload);
      return res.json({ ok: true, image: stored.image, path: stored.path, bucket: stored.bucketName });
    } catch (err) {
      logger.error("adminNewsletterImage failed", { message: err.message || "Newsletter image upload failed" });
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
        const limit = Math.min(500, Math.max(1, Number(req.query.limit || 50)));
        const snap = await db.collection("orders").orderBy("createdAt", "desc").limit(limit).get();
        const orders = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
        return res.json({ orders });
      }

      if (req.method === "PATCH" || req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        if (req.method === "POST" && String(body.action || "").trim() === "createManualOrder") {
          const order = await createManualOrderFromAdmin(body.order || body, adminUser);
          return res.json({ ok: true, order });
        }

        const id = String(body.id || "").trim();
        if (!id) return jsonError(res, 400, "Missing order id");

        const orderRef = db.collection("orders").doc(id);
        const existingSnap = await orderRef.get();
        if (!existingSnap.exists) return jsonError(res, 404, "Order not found");
        const existingOrder = existingSnap.exists ? { id, ...existingSnap.data() } : { id };
        if (String(body.action || "").trim() === "sendFeedbackRequest") {
          const feedbackEmail = await sendOrderFeedbackEmail(existingOrder, adminUser);
          return res.json({ ok: true, feedbackEmail });
        }
        if (String(body.action || "").trim() === "sendFeedbackRequestTest") {
          const origin = String(req.headers.origin || "").trim();
          const feedbackBaseUrl = isLocalRequest(req) && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ? origin : GRUBZ_URL;
          const feedbackEmail = await sendOrderFeedbackEmail(existingOrder, adminUser, { testOnly: true, feedbackBaseUrl });
          return res.json({ ok: true, feedbackEmail });
        }
        if (String(body.action || "").trim() === "sendLockerReminder") {
          const lockerReminderEmail = await sendOrderLockerReminderEmail(existingOrder, adminUser);
          return res.json({ ok: true, lockerReminderEmail });
        }
        if (String(body.action || "").trim() === "approveBoxNowLockerNotifications") {
          const review = existingOrder.boxNowNotificationReview || {};
          if (review.status !== "pending") return jsonError(res, 409, "This BOX NOW notification recommendation is no longer pending.");
          const parcelId = String(review.parcelId || "").trim();
          const parcelKey = orderStatusDocKey(parcelId || "unknown");
          const latestEvent = normalizeOrderStatus(existingOrder.boxNowShipment?.parcelEvents?.[parcelKey]?.event).replace(/[_\s]+/g, "-");
          if (latestEvent !== "final-destination") return jsonError(res, 409, "This parcel is no longer waiting at the locker.");
          const arrivalEmail = await sendBoxNowLockerArrivalEmail(existingOrder, parcelId);
          const reminder = await scheduleAutomaticBoxNowLockerReminder(existingOrder, {
            parcelId,
            eventTime: review.eventTime || existingOrder.boxNowShipment?.parcelEvents?.[parcelKey]?.eventTime || "",
          });
          await orderRef.set({
            boxNowNotificationReview: {
              ...review,
              status: "approved",
              approvedAt: now(),
              approvedBy: adminUser.uid || "",
              arrivalEmail,
              reminder,
            },
            updatedAt: now(),
          }, { merge: true });
          return res.json({ ok: true, arrivalEmail, reminder });
        }
        if (String(body.action || "").trim() === "dismissBoxNowLockerNotifications") {
          const review = existingOrder.boxNowNotificationReview || {};
          if (review.status !== "pending") return jsonError(res, 409, "This BOX NOW notification recommendation is no longer pending.");
          await orderRef.set({
            boxNowNotificationReview: { ...review, status: "dismissed", dismissedAt: now(), dismissedBy: adminUser.uid || "" },
            updatedAt: now(),
          }, { merge: true });
          return res.json({ ok: true });
        }
        if (String(body.action || "").trim() === "scheduleEmail") {
          const scheduledEmail = await scheduleOrderEmail(
            existingOrder,
            String(body.emailType || "").trim(),
            body.sendAt,
            adminUser,
            body.previousFulfillmentStatus || ""
          );
          return res.json({ ok: true, scheduledEmail });
        }
	        if (String(body.action || "").trim() === "uploadInvoiceReceiptPdf") {
	          const dataUrl = String(body.pdfDataUrl || "");
	          if (dataUrl.length > 14 * 1024 * 1024) return jsonError(res, 400, "PDF is too large. Use a file up to 10 MB.");
	          const match = dataUrl.match(/^data:application\/pdf;base64,([a-z0-9+/=\s]+)$/i);
	          if (!match) return jsonError(res, 400, "Upload a PDF file.");
	          const buffer = Buffer.from(match[1].replace(/\s/g, ""), "base64");
	          if (!buffer.length || buffer.length > 10 * 1024 * 1024) return jsonError(res, 400, "PDF must be between 1 byte and 10 MB.");
	          if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") return jsonError(res, 400, "The uploaded file is not a valid PDF.");
	          const originalName = String(body.filename || "invoice-receipt.pdf").trim().slice(0, 180) || "invoice-receipt.pdf";
	          const safeName = originalName.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "invoice-receipt.pdf";
	          const bucket = getStorage().bucket(FIREBASE_STORAGE_BUCKET);
	          const path = `order-documents/${id}/${Date.now()}-${safeName.toLowerCase().endsWith(".pdf") ? safeName : `${safeName}.pdf`}`;
	          const file = bucket.file(path);
	          await file.save(buffer, {
	            resumable: false,
	            metadata: {
	              contentType: "application/pdf",
	              cacheControl: "private, no-store, max-age=0",
	              metadata: { orderId: id, uploadedBy: adminUser.uid || "" },
	            },
	          });
	          const document = {
	            bucket: bucket.name,
	            path,
	            filename: originalName.toLowerCase().endsWith(".pdf") ? originalName : `${originalName}.pdf`,
	            size: buffer.length,
	            uploadedAt: now(),
	            uploadedBy: adminUser.uid || "",
	          };
	          await orderRef.set({ invoiceReceiptPdf: document, updatedAt: now(), updatedBy: adminUser.uid }, { merge: true });
	          const previous = existingOrder.invoiceReceiptPdf || {};
	          if (previous.path && previous.path !== path) {
	            getStorage().bucket(previous.bucket || FIREBASE_STORAGE_BUCKET).file(previous.path).delete({ ignoreNotFound: true })
	              .catch(err => logger.warn("Old invoice/receipt PDF cleanup failed", { orderId: id, message: err.message || "Delete failed" }));
	          }
	          logger.info("Admin uploaded invoice/receipt PDF", { orderId: id, path, size: buffer.length, adminUid: adminUser.uid });
	          return res.json({ ok: true, document });
	        }
	        if (String(body.action || "").trim() === "downloadInvoiceReceiptPdf") {
	          const document = existingOrder.invoiceReceiptPdf || {};
	          if (!document.path) return jsonError(res, 404, "No invoice/receipt PDF is attached to this order.");
	          const [buffer] = await getStorage().bucket(document.bucket || FIREBASE_STORAGE_BUCKET).file(document.path).download();
	          return res.json({
	            ok: true,
	            filename: document.filename || `${publicOrderId(existingOrder)}-invoice-receipt.pdf`,
	            contentType: "application/pdf",
	            base64: buffer.toString("base64"),
	          });
	        }
        const previousFulfillmentStatus = String(existingOrder.fulfillmentStatus || "");
	        const allowed = {};
	        if (body.status != null) {
	          const orderStatus = String(body.status).trim().toLowerCase();
	          if (!["active", "completed", "cancelled"].includes(orderStatus)) {
	            return jsonError(res, 400, "Order status must be Active, Completed, or Cancelled.");
	          }
	          allowed.status = orderStatus;
	        }
	        if (body.paymentStatus != null) allowed.paymentStatus = String(body.paymentStatus).trim();
	        if (body.fulfillmentStatus != null) allowed.fulfillmentStatus = String(body.fulfillmentStatus).trim();
	        if (normalizeOrderStatus(allowed.fulfillmentStatus) === "delivered") allowed.status = "completed";
	        if (body.invoiceReceiptIssued != null) {
	          allowed.invoiceReceiptIssued = body.invoiceReceiptIssued === true;
	          allowed.invoiceReceiptIssuedAt = body.invoiceReceiptIssued === true
	            ? (existingOrder.invoiceReceiptIssued === true && existingOrder.invoiceReceiptIssuedAt
	              ? existingOrder.invoiceReceiptIssuedAt
	              : now())
	            : null;
	        }
	        if (body.aadeInvoiceReceiptId != null) {
	          allowed.aadeInvoiceReceiptId = String(body.aadeInvoiceReceiptId || "").trim().slice(0, 240);
	        }
        if (Object.prototype.hasOwnProperty.call(body, "deliveredAt")) {
          if (!body.deliveredAt) {
            allowed.deliveredAt = null;
          } else {
            const deliveredDate = new Date(`${String(body.deliveredAt).trim()}T12:00:00`);
            if (Number.isNaN(deliveredDate.getTime())) return jsonError(res, 400, "Invalid delivered date.");
            allowed.deliveredAt = Timestamp.fromDate(deliveredDate);
          }
        }
        if (body.notes != null) allowed.notes = String(body.notes).slice(0, 5000);
        if (Object.prototype.hasOwnProperty.call(body, "boxNowPaymentMode")) {
          const paymentMode = String(body.boxNowPaymentMode || "").trim();
          allowed.boxNowPaymentMode = ["prepaid", "cod"].includes(paymentMode) ? paymentMode : null;
        }
        if (Object.prototype.hasOwnProperty.call(body, "boxNowCompartmentSize")) {
          const compartmentSize = Number(body.boxNowCompartmentSize || 0);
          allowed.boxNowCompartmentSize = [2, 3].includes(compartmentSize) ? compartmentSize : null;
        }
        if (Object.prototype.hasOwnProperty.call(body, "boxNowCodAmountCents")) {
          allowed.boxNowCodAmountCents = Math.max(0, Math.round(Number(body.boxNowCodAmountCents || 0)));
        }
        if (body.stripePaymentLink != null || body.paymentLink != null) {
          const paymentLink = sanitizeStripePaymentLink(body.stripePaymentLink || body.paymentLink || "");
          allowed.stripePaymentLink = paymentLink;
          allowed.paymentLink = paymentLink;
          allowed.metadata = {
            ...(existingOrder.metadata || {}),
            stripePaymentLink: paymentLink,
          };
        }
        if (body.shipping && typeof body.shipping === "object") {
          allowed.shipping = body.shipping;
        }
        if (Object.prototype.hasOwnProperty.call(body, "items")) {
          if (normalizeOrderStatus(existingOrder.fulfillmentStatus || "new") !== "new") {
            return jsonError(res, 400, "Products can only be edited while fulfillment is New.");
          }
          if (existingOrder.boxNowShipment?.deliveryRequestId) {
            return jsonError(res, 400, "Products cannot be edited after BOX NOW delivery has been created.");
          }
          const productsMap = await getProductsMap({ includeInactive: true });
          const nextItems = orderItemsFromCart(Array.isArray(body.items) ? body.items : [], productsMap, existingOrder.stripeMode || "test", { allowInactive: true });
          if (!nextItems.length) return jsonError(res, 400, "Add at least one product.");
          const amountSubtotal = orderItemsSubtotal({ items: nextItems });
          const amountShipping = Math.max(0, Number(existingOrder.amountShipping || existingOrder.boxnowFee?.amount || 0));
          const existingPricing = orderPricing(existingOrder);
          const amountDiscount = Math.max(0, Number(existingOrder.amountDiscount || existingPricing.discount || 0));
          const amountTotal = Math.max(0, amountSubtotal + amountShipping - amountDiscount);
          allowed.items = nextItems;
          allowed.amountSubtotal = amountSubtotal;
          allowed.amountShipping = amountShipping;
          allowed.amountDiscount = amountDiscount;
          allowed.amountTotal = amountTotal;
          allowed.amountDue = amountTotal;
          allowed.manualPricingOverride = false;
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

        const fulfillmentWillChange = (
          allowed.fulfillmentStatus != null &&
          normalizeOrderStatus(allowed.fulfillmentStatus) !== normalizeOrderStatus(previousFulfillmentStatus)
        );
        if (
          fulfillmentWillChange &&
          normalizeOrderStatus(allowed.fulfillmentStatus) === "delivered" &&
          !allowed.deliveredAt &&
          !existingOrder.deliveredAt
        ) {
          allowed.deliveredAt = now();
        }
        if (fulfillmentWillChange && body.sendFulfillmentEmail === true) {
          const fulfillmentKey = normalizeOrderStatus(allowed.fulfillmentStatus);
          const settings = await getOrderEmailSettings();
          const template = settings.templates.find(item => item.enabled !== false && item.templateContext !== "customer" && item.fulfillmentKey === fulfillmentKey);
          const content = template ? templateContentForLanguage(template, existingOrder.language || existingOrder.locale || "en") : null;
          const orderCouponCode = normalizeCouponCode(existingOrder.couponCode || existingOrder.coupon || existingOrder.metadata?.couponCode || existingOrder.metadata?.coupon || "");
          if (content && containsCouponPlaceholder(content.body) && !orderCouponCode) {
            return jsonError(res, 400, "This fulfillment template uses {coupon}, but the order has no coupon code. Remove the placeholder before sending.");
          }
        }

        const inventoryNeedsRereservation = Array.isArray(allowed.items) && String(existingOrder.inventoryState || "") === "reserved";
        if (inventoryNeedsRereservation) await transitionOrderInventory(id, "released", adminUser.uid);
        await orderRef.set(allowed, { merge: true });

        let inventoryUpdate = { skipped: true, reason: "no_inventory_transition" };
        const nextFulfillment = normalizeOrderStatus(allowed.fulfillmentStatus ?? existingOrder.fulfillmentStatus ?? "new");
        const nextOrderStatus = String(allowed.status ?? existingOrder.status ?? "").trim().toLowerCase();
        if (nextOrderStatus === "cancelled" || nextFulfillment === "cancelled") {
          inventoryUpdate = await transitionOrderInventory(id, "released", adminUser.uid);
        } else if (["packed", "shipped", "delivered"].includes(nextFulfillment)) {
          inventoryUpdate = await transitionOrderInventory(id, "consumed", adminUser.uid);
        } else if (
          ["paid", "cash_on_delivery_pending"].includes(String(allowed.paymentStatus ?? existingOrder.paymentStatus ?? "").trim().toLowerCase()) &&
          (String(existingOrder.inventoryState || "none") === "none" || inventoryNeedsRereservation)
        ) {
          inventoryUpdate = await transitionOrderInventory(id, "reserved", adminUser.uid);
        }

        let statusEmail = { skipped: true, reason: "fulfillment_not_updated" };
        if (fulfillmentWillChange) {
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

        return res.json({ ok: true, statusEmail, inventoryUpdate });
      }

      if (req.method === "DELETE") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const requestedIds = Array.isArray(body.ids) ? body.ids : [];
        const ids = [...new Set(requestedIds.map(value => String(value || "").trim()).filter(Boolean))];
        if (ids.length) {
          if (ids.length > 500) return jsonError(res, 400, "Delete at most 500 orders at a time");
          const refs = ids.map(id => db.collection("orders").doc(id));
          const snapshots = await db.getAll(...refs);
          for (const snap of snapshots.filter(item => item.exists)) {
            if (String(snap.data()?.inventoryState || "") === "reserved") {
              await transitionOrderInventory(snap.id, "released", adminUser.uid);
            }
          }
          const existingRefs = snapshots.filter(snap => snap.exists).map(snap => snap.ref);
          for (let offset = 0; offset < existingRefs.length; offset += 450) {
            const batch = db.batch();
            existingRefs.slice(offset, offset + 450).forEach(ref => batch.delete(ref));
            await batch.commit();
          }
	          await Promise.allSettled(snapshots.filter(snap => snap.exists && snap.data()?.invoiceReceiptPdf?.path).map(snap => {
	            const document = snap.data().invoiceReceiptPdf;
	            return getStorage().bucket(document.bucket || FIREBASE_STORAGE_BUCKET).file(document.path).delete({ ignoreNotFound: true });
	          }));
          const deletedIds = existingRefs.map(ref => ref.id);
          logger.info("Admin bulk deleted orders", {
            requested: ids.length,
            deleted: deletedIds.length,
            orderIds: deletedIds,
            adminUid: adminUser.uid,
            adminEmail: adminUser.email || "",
          });
          return res.json({ ok: true, requested: ids.length, deleted: deletedIds.length, deletedIds });
        }
        const id = String(req.query.id || body.id || "").trim();
        if (!id) return jsonError(res, 400, "Missing order id or ids");
        const orderRef = db.collection("orders").doc(id);
        const snap = await orderRef.get();
        if (!snap.exists) return jsonError(res, 404, "Order not found");
        if (String(snap.data()?.inventoryState || "") === "reserved") {
          await transitionOrderInventory(id, "released", adminUser.uid);
        }
        await orderRef.delete();
	        const attachedDocument = snap.data()?.invoiceReceiptPdf || {};
	        if (attachedDocument.path) {
	          await getStorage().bucket(attachedDocument.bucket || FIREBASE_STORAGE_BUCKET).file(attachedDocument.path).delete({ ignoreNotFound: true })
	            .catch(err => logger.warn("Deleted order PDF cleanup failed", { orderId: id, message: err.message || "Delete failed" }));
	        }
        logger.info("Admin deleted order", {
          orderId: id,
          adminUid: adminUser.uid,
          adminEmail: adminUser.email || "",
        });
        return res.json({ ok: true });
      }

      return jsonError(res, 405, "Use GET, POST, PATCH, or DELETE");
    } catch (err) {
      return adminError(res, err);
    }
  }
);

exports.contact = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
    secrets: [SMTP_USER, SMTP_PASS, ORDER_NOTIFICATION_FROM],
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method !== "POST") return jsonError(res, 405, "Use POST to send a message.");
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (String(body.website || "").trim()) return res.json({ ok: true });
      const name = String(body.name || "").trim().slice(0, 180);
      const email = normalizedEmail(body.email || "");
      const message = String(body.message || "").trim().slice(0, 5000);
      const language = String(body.language || "en").toLowerCase() === "el" ? "el" : "en";
      if (!name) return jsonError(res, 400, "Enter your name.");
      if (!validEmailAddress(email)) return jsonError(res, 400, "Enter a valid email address.");
      if (message.length < 10) return jsonError(res, 400, "Enter a message of at least 10 characters.");
      const subject = `GRUBZ website contact: ${name}`;
      const text = [
        `Name: ${name}`,
        `Email: ${email}`,
        `Language: ${language}`,
        "",
        message,
      ].join("\n");
      const html = `
        <h2>GRUBZ website contact</h2>
        <p><strong>Name:</strong> ${escapeHtml(name)}<br>
        <strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a><br>
        <strong>Language:</strong> ${escapeHtml(language)}</p>
        <p style="white-space:pre-wrap">${escapeHtml(message)}</p>
      `;
      const result = await sendEmail({
        to: GRUBZ_INFO_EMAIL,
        from: secretValue(ORDER_NOTIFICATION_FROM, defaultNotificationFrom()),
        subject,
        text,
        html,
      });
      if (result.skipped) throw Object.assign(new Error(result.reason || "Email delivery is unavailable."), { status: 503 });
      return res.json({ ok: true });
    } catch (err) {
      logger.error("Contact form failed", { error: err.message || "Contact form failed" });
      return jsonError(res, Number(err.status || 400), err.message || "Message could not be sent.");
    }
  }
);

exports.newsletter = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method === "GET" && String(req.query.action || "") === "unsubscribe") {
        const publicBaseUrl = newsletterPublicBaseUrl(req);
        const token = String(req.query.token || "").trim();
        if (!token) return res.redirect(302, `${publicBaseUrl}/?newsletter=invalid#newsletter`);
        const snap = await db.collection(NEWSLETTER_SUBSCRIBERS_COLLECTION)
          .where("unsubscribeToken", "==", token)
          .limit(1)
          .get();
        if (snap.empty) return res.redirect(302, `${publicBaseUrl}/?newsletter=invalid#newsletter`);
        await snap.docs[0].ref.set({
          status: "unsubscribed",
          unsubscribedAt: now(),
          updatedAt: now(),
        }, { merge: true });
        return res.redirect(302, `${publicBaseUrl}/?newsletter=unsubscribed#newsletter`);
      }
      if (req.method !== "POST") return jsonError(res, 405, "Use POST to subscribe.");
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const action = String(body.action || "subscribe").trim().toLowerCase();
      const email = normalizedEmail(body.email || "");
      if (!validEmailAddress(email)) return jsonError(res, 400, "Enter a valid email address.");
      const ref = db.collection(NEWSLETTER_SUBSCRIBERS_COLLECTION).doc(newsletterSubscriberId(email));
      const existingSnap = await ref.get();
      const existing = existingSnap.exists ? existingSnap.data() : {};
      if (action === "unsubscribe") {
        await ref.set({
          email,
          status: "unsubscribed",
          unsubscribedAt: now(),
          updatedAt: now(),
        }, { merge: true });
        return res.json({ ok: true, status: "unsubscribed" });
      }
      const language = String(body.language || "en").toLowerCase() === "el" ? "el" : "en";
      await ref.set({
        email,
        emailLower: email,
        name: String(body.name || "").trim().slice(0, 180),
        language,
        status: "subscribed",
        source: String(body.source || "storefront_footer").trim().slice(0, 120),
        consentText: String(body.consentText || "").trim().slice(0, 500),
        consentVersion: "2026-07-27",
        unsubscribeToken: existing.unsubscribeToken || randomUUID(),
        subscribedAt: now(),
        unsubscribedAt: null,
        createdAt: existing.createdAt || now(),
        updatedAt: now(),
      }, { merge: true });
      return res.json({ ok: true, status: "subscribed" });
    } catch (err) {
      logger.error("Newsletter request failed", { error: err.message || "Newsletter request failed" });
      return jsonError(res, Number(err.status || 400), err.message || "Newsletter request failed");
    }
  }
);

exports.adminNewsletter = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
    timeoutSeconds: 540,
    secrets: [SMTP_USER, SMTP_PASS, ORDER_NOTIFICATION_FROM, OPENAI_API_KEY],
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      const adminUser = await requireAdmin(req);
      if (req.method === "GET") {
        const limit = Math.min(500, Math.max(1, Number(req.query.limit || 500)));
        const snap = await db.collection(NEWSLETTER_SUBSCRIBERS_COLLECTION).limit(limit).get();
        const subscribers = snap.docs
          .map(publicNewsletterSubscriber)
          .sort((a, b) => millisFromTimestamp(b.subscribedAt) - millisFromTimestamp(a.subscribedAt));
        const ideasSnap = await db.collection(NEWSLETTER_IDEAS_COLLECTION).limit(50).get();
        const ideas = ideasSnap.docs
          .map(doc => ({ id: doc.id, ...(doc.data() || {}) }))
          .sort((a, b) => millisFromTimestamp(b.createdAt) - millisFromTimestamp(a.createdAt))
          .slice(0, 20);
        return res.json({ subscribers, ideas });
      }
      if (req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        if (body.action === "send" || body.action === "test") {
          const result = await sendNewsletter({
            adminUser,
            subject: body.subject,
            body: body.body,
            language: body.language,
            testOnly: body.action === "test",
            confirmDuplicate: body.confirmDuplicate === true,
            publicBaseUrl: newsletterPublicBaseUrl(req),
            image: body.image || {},
          });
          return res.json(result);
        }
        if (body.action === "generateIdeas") {
          const apiKey = String(OPENAI_API_KEY.value() || "").trim();
          if (!apiKey) return jsonError(res, 503, "OpenAI is not configured.");
          const language = body.language === "el" ? "el" : "en";
          const focus = String(body.focus || "").trim().slice(0, 500);
          const [productsMap, recentSends] = await Promise.all([
            getProductsMap(),
            db.collection(NEWSLETTER_SENDS_COLLECTION).orderBy("createdAt", "desc").limit(12).get(),
          ]);
          const products = Object.values(productsMap).map(product => ({
            name: language === "el" ? (product.nameEl || product.name) : product.name,
            description: language === "el" ? (product.descriptionEl || product.description) : product.description,
            price: Number.isFinite(Number(product.amount)) ? `${(Number(product.amount) / 100).toFixed(2)} EUR` : "",
          }));
          const recentSubjects = recentSends.docs
            .map(doc => String((doc.data() || {}).subject || "").trim())
            .filter(Boolean);
          const client = new OpenAI({ apiKey });
          const response = await client.responses.create({
            model: DEFAULT_CHATBOT_SETTINGS.model,
            instructions: [
              "You are the newsletter ideas agent for GRUBZ, a Greek ecommerce brand selling dried black soldier fly larvae and frass products.",
              `Write in ${language === "el" ? "Greek" : "English"}.`,
              "Return only valid JSON: an array of exactly 4 objects with keys title, subject, body, and reason.",
              "Each idea must be distinct, genuinely useful, accurate, warm, concise, and ready to edit as an email.",
              "Start body with {greeting}. Include {grubz_url} naturally as the call-to-action URL. Do not add an unsubscribe footer; the system adds it.",
              "Do not invent discounts, research claims, product facts, availability, prices, or guarantees. Use only the supplied product facts.",
              "Avoid repeating recent newsletter subjects. Do not use markdown code fences.",
            ].join("\n"),
            input: JSON.stringify({ focus: focus || "Choose timely, helpful topics for GRUBZ customers.", products, recentSubjects }),
            max_output_tokens: 2400,
            store: false,
          });
          let raw = responseTextFromOpenAI(response).trim();
          raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
          let generated;
          try {
            generated = JSON.parse(raw);
          } catch (error) {
            logger.error("Newsletter ideas JSON parse failed", { error: error.message, raw: raw.slice(0, 1000) });
            return jsonError(res, 502, "The ideas agent returned an invalid response. Please try again.");
          }
          if (!Array.isArray(generated)) return jsonError(res, 502, "The ideas agent returned an invalid response. Please try again.");
          const ideas = [];
          for (const item of generated.slice(0, 6)) {
            const idea = {
              title: String(item.title || "").trim().slice(0, 180),
              subject: String(item.subject || "").trim().slice(0, 180),
              body: String(item.body || "").trim().slice(0, 12000),
              reason: String(item.reason || "").trim().slice(0, 500),
            };
            if (!idea.title || !idea.subject || !idea.body) continue;
            const ref = db.collection(NEWSLETTER_IDEAS_COLLECTION).doc();
            const stored = { ...idea, language, focus, status: "available", createdAt: now(), createdBy: adminUser.uid || "" };
            await ref.set(stored);
            ideas.push({ id: ref.id, ...stored });
          }
          if (!ideas.length) return jsonError(res, 502, "The ideas agent did not produce usable ideas. Please try again.");
          return res.json({ ok: true, ideas, model: response.model || DEFAULT_CHATBOT_SETTINGS.model });
        }
        if (body.action === "useIdea") {
          const id = String(body.id || "").trim();
          if (!id) return jsonError(res, 400, "Missing newsletter idea.");
          await db.collection(NEWSLETTER_IDEAS_COLLECTION).doc(id).set({
            status: "used",
            usedAt: now(),
            usedBy: adminUser.uid || "",
          }, { merge: true });
          return res.json({ ok: true });
        }
        if (body.action === "translateIdea") {
          const apiKey = String(OPENAI_API_KEY.value() || "").trim();
          if (!apiKey) return jsonError(res, 503, "OpenAI is not configured.");
          const id = String(body.id || "").trim();
          if (!id) return jsonError(res, 400, "Missing newsletter idea.");
          const sourceSnap = await db.collection(NEWSLETTER_IDEAS_COLLECTION).doc(id).get();
          if (!sourceSnap.exists) return jsonError(res, 404, "Newsletter idea not found.");
          const source = sourceSnap.data() || {};
          if (source.language === "el") return jsonError(res, 400, "This newsletter idea is already in Greek.");
          const client = new OpenAI({ apiKey });
          const response = await client.responses.create({
            model: DEFAULT_CHATBOT_SETTINGS.model,
            instructions: [
              "Translate this GRUBZ newsletter idea into natural, polished Greek.",
              "Return only valid JSON with keys title, subject, body, and reason.",
              "Preserve every placeholder exactly, including {greeting}, {customerName}, {customerEmail}, {grubz_url}, and {unsubscribe_url}.",
              "Preserve meaning, tone, paragraph structure, product names, URLs, quantities, and facts. Do not add claims or offers.",
              "Do not use markdown code fences.",
            ].join("\n"),
            input: JSON.stringify({ title: source.title || "", subject: source.subject || "", body: source.body || "", reason: source.reason || "" }),
            max_output_tokens: 1800,
            store: false,
          });
          let raw = responseTextFromOpenAI(response).trim();
          raw = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
          let translated;
          try {
            translated = JSON.parse(raw);
          } catch (error) {
            logger.error("Newsletter idea translation JSON parse failed", { error: error.message, raw: raw.slice(0, 1000) });
            return jsonError(res, 502, "The ideas agent returned an invalid translation. Please try again.");
          }
          const idea = {
            title: String(translated.title || "").trim().slice(0, 180),
            subject: String(translated.subject || "").trim().slice(0, 180),
            body: String(translated.body || "").trim().slice(0, 12000),
            reason: String(translated.reason || "").trim().slice(0, 500),
          };
          if (!idea.title || !idea.subject || !idea.body) return jsonError(res, 502, "The ideas agent returned an incomplete translation. Please try again.");
          const ref = db.collection(NEWSLETTER_IDEAS_COLLECTION).doc();
          const stored = {
            ...idea,
            language: "el",
            focus: source.focus || "",
            sourceIdeaId: id,
            status: "available",
            createdAt: now(),
            createdBy: adminUser.uid || "",
          };
          await ref.set(stored);
          await sourceSnap.ref.set({ greekIdeaId: ref.id, updatedAt: now() }, { merge: true });
          return res.json({ ok: true, idea: { id: ref.id, ...stored }, model: response.model || DEFAULT_CHATBOT_SETTINGS.model });
        }
        return jsonError(res, 400, "Unknown newsletter action.");
      }
      if (req.method === "PATCH") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const id = String(body.id || "").trim();
        if (!/^[a-f0-9]{64}$/.test(id)) return jsonError(res, 400, "Invalid subscriber.");
        if (body.status !== "unsubscribed") return jsonError(res, 400, "Subscribers must opt in again from the storefront.");
        const status = "unsubscribed";
        await db.collection(NEWSLETTER_SUBSCRIBERS_COLLECTION).doc(id).set({
          status,
          unsubscribedAt: now(),
          updatedAt: now(),
          updatedBy: adminUser.uid || "",
        }, { merge: true });
        return res.json({ ok: true, status });
      }
      return jsonError(res, 405, "Use GET, POST, or PATCH.");
    } catch (err) {
      return adminError(res, err);
    }
  }
);

function emailHistoryTime(record = {}) {
  return record.sentAt || record.updatedAt || record.scheduledAt || record.createdAt || null;
}

function emailHistoryMillis(record = {}) {
  return millisFromTimestamp(emailHistoryTime(record));
}

exports.adminEmailHistory = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      await requireAdmin(req);
      if (req.method !== "GET") return jsonError(res, 405, "Use GET.");
      const limit = Math.min(1000, Math.max(1, Number(req.query.limit || 500)));
      const [orderSnap, bulkSnap, newsletterSnap, scheduledSnap] = await Promise.all([
        db.collection("orderNotifications").orderBy("createdAt", "desc").limit(limit).get(),
        db.collection("bulkCustomerEmails").orderBy("createdAt", "desc").limit(100).get(),
        db.collection(NEWSLETTER_SENDS_COLLECTION).orderBy("createdAt", "desc").limit(100).get(),
        db.collection(SCHEDULED_ORDER_EMAILS_COLLECTION).orderBy("createdAt", "desc").limit(100).get(),
      ]);
      const rows = [];
      for (const doc of orderSnap.docs) {
        const item = doc.data() || {};
        const recipient = normalizedEmail(item.recipientEmail || item.customerEmail || item.result?.accepted?.[0] || "");
        if (!recipient) continue;
        rows.push({
          id: doc.id,
          source: "order",
          type: item.type || "order_email",
          subject: item.subject || "",
          recipient,
          orderId: item.orderId || "",
          orderNumber: item.orderNumber || "",
          status: item.status || "unknown",
          messageId: item.result?.messageId || "",
          sentAt: emailHistoryTime(item),
        });
      }
      const expandBatch = (snap, source, fallbackType) => {
        for (const doc of snap.docs) {
          const item = doc.data() || {};
          const results = Array.isArray(item.results) ? item.results : [];
          for (const result of results) {
            rows.push({
              id: `${doc.id}:${normalizedEmail(result.email || result.deliveredTo || "")}`,
              sendId: doc.id,
              source,
              type: fallbackType,
              subject: item.subject || "",
              recipient: normalizedEmail(result.email || result.deliveredTo || ""),
              orderId: "",
              orderNumber: "",
              status: result.ok ? "sent" : result.skipped ? "skipped" : "failed",
              messageId: result.messageId || "",
              error: result.error || result.reason || "",
              sentAt: item.sentAt || item.updatedAt || item.createdAt || null,
            });
          }
        }
      };
      expandBatch(bulkSnap, "bulk", "customer_email");
      expandBatch(newsletterSnap, "newsletter", "newsletter");
      for (const doc of scheduledSnap.docs) {
        const item = doc.data() || {};
        if (item.status === "sent") continue;
        rows.push({
          id: doc.id,
          source: "scheduled",
          type: item.type || "scheduled_email",
          subject: "",
          recipient: "",
          orderId: item.orderId || "",
          orderNumber: item.orderNumber || "",
          status: item.status,
          messageId: "",
          error: item.error || "",
          scheduledAt: item.scheduledAt || null,
          sentAt: item.scheduledAt || item.createdAt || null,
        });
      }
      rows.sort((a, b) => emailHistoryMillis(b) - emailHistoryMillis(a));
      return res.json({ emails: rows.slice(0, limit) });
    } catch (err) {
      return adminError(res, err);
    }
  }
);

async function deleteQueryDocuments(query) {
  const snap = await query.get();
  if (snap.empty) return 0;
  for (let offset = 0; offset < snap.docs.length; offset += 400) {
    const batch = db.batch();
    snap.docs.slice(offset, offset + 400).forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
  return snap.size;
}

async function scrubCustomerFromBatchEmailHistory(collectionName, email) {
  if (!email) return 0;
  const snap = await db.collection(collectionName).orderBy("createdAt", "desc").limit(500).get();
  let changed = 0;
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    const results = Array.isArray(data.results) ? data.results : [];
    const recipients = Array.isArray(data.recipients) ? data.recipients : [];
    const nextResults = results.filter(item => normalizedEmail(item?.email || item?.deliveredTo || "") !== email);
    const nextRecipients = recipients.filter(item => normalizedEmail(item?.email || item || "") !== email);
    if (nextResults.length === results.length && nextRecipients.length === recipients.length) continue;
    const update = { updatedAt: now() };
    if (Array.isArray(data.results)) update.results = nextResults;
    if (Array.isArray(data.recipients)) update.recipients = nextRecipients;
    await doc.ref.set(update, { merge: true });
    changed += 1;
  }
  return changed;
}

async function deleteCustomerCompletely({ uid, email, adminUser }) {
  if (!uid || uid === "guest" || uid.includes("/")) throw Object.assign(new Error("Choose a registered customer."), { status: 400 });
  if (uid === adminUser.uid) throw Object.assign(new Error("You cannot delete your own administrator account."), { status: 400 });
  const emailKey = normalizedEmail(email || "");
  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  const storedUser = userSnap.exists ? userSnap.data() || {} : {};
  const resolvedEmail = emailKey || normalizedEmail(storedUser.email || storedUser.emailLower || "");

  const orderDocs = new Map();
  const uidOrders = await db.collection("orders").where("uid", "==", uid).get();
  uidOrders.docs.forEach(doc => orderDocs.set(doc.id, doc));
  if (resolvedEmail) {
    const emailOrders = await db.collection("orders").where("customer.email", "==", resolvedEmail).get();
    emailOrders.docs.forEach(doc => orderDocs.set(doc.id, doc));
  }

  const anonymizedAt = now();
  const orderIds = [];
  for (const doc of orderDocs.values()) {
    const order = doc.data() || {};
    const shipping = order.shipping && typeof order.shipping === "object" ? order.shipping : {};
    const metadata = order.metadata && typeof order.metadata === "object" ? order.metadata : {};
    await doc.ref.set({
      uid: "",
      customer: { uid: "", email: "", name: "Deleted customer", phone: "" },
      shipping: {
        ...shipping,
        name: "",
        phone: "",
        email: "",
        addressLine1: "",
        line1: "",
        addressLine2: "",
        line2: "",
        city: "",
        region: "",
        postal: "",
        postalCode: "",
      },
      metadata: {
        ...metadata,
        uid: "deleted",
        shippingName: "",
        shippingPhone: "",
      },
      customerDeleted: true,
      customerDeletedAt: anonymizedAt,
      customerDeletedBy: adminUser.uid,
      updatedAt: anonymizedAt,
    }, { merge: true });
    orderIds.push(doc.id);
  }

  let deletedRelatedRecords = 0;
  if (resolvedEmail) {
    const emailQueries = [
      db.collection(MARKETING_LEADS_COLLECTION).where("email", "==", resolvedEmail),
      db.collection(ABANDONED_CARTS_COLLECTION).where("email", "==", resolvedEmail),
      db.collection(ORDER_FEEDBACK_COLLECTION).where("customerEmail", "==", resolvedEmail),
      db.collection("orderNotifications").where("recipientEmail", "==", resolvedEmail),
      db.collection("orderNotifications").where("customerEmail", "==", resolvedEmail),
    ];
    for (const query of emailQueries) deletedRelatedRecords += await deleteQueryDocuments(query);
    await Promise.all([
      db.collection(NEWSLETTER_SUBSCRIBERS_COLLECTION).doc(newsletterSubscriberId(resolvedEmail)).delete(),
      db.collection(EMAIL_RESERVATIONS_COLLECTION).doc(emailReservationDocId(resolvedEmail)).delete(),
    ]);
    deletedRelatedRecords += await scrubCustomerFromBatchEmailHistory("bulkCustomerEmails", resolvedEmail);
    deletedRelatedRecords += await scrubCustomerFromBatchEmailHistory(NEWSLETTER_SENDS_COLLECTION, resolvedEmail);
  }
  for (const orderId of orderIds) {
    deletedRelatedRecords += await deleteQueryDocuments(db.collection("orderNotifications").where("orderId", "==", orderId));
    deletedRelatedRecords += await deleteQueryDocuments(db.collection(SCHEDULED_ORDER_EMAILS_COLLECTION).where("orderId", "==", orderId));
  }

  const collaborationId = String(storedUser.collaborationId || "").trim();
  if (collaborationId && !collaborationId.includes("/")) {
    const collaborationRef = db.collection(COLLABORATIONS_COLLECTION).doc(collaborationId);
    const collaborationSnap = await collaborationRef.get();
    if (collaborationSnap.exists && collaborationSnap.data()?.customerKey === `uid:${uid}`) {
      await collaborationRef.set({ customerKey: "", updatedAt: now(), updatedBy: adminUser.uid }, { merge: true });
    }
  }

  await userRef.delete();
  try {
    await getAdminAuth().deleteUser(uid);
  } catch (err) {
    if (err?.code !== "auth/user-not-found") throw err;
  }
  logger.info("Customer fully deleted", {
    uid,
    email: resolvedEmail,
    anonymizedOrders: orderIds.length,
    deletedRelatedRecords,
    deletedBy: adminUser.uid,
  });
  return { ok: true, uid, anonymizedOrders: orderIds.length, deletedRelatedRecords };
}

exports.adminCustomers = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
    secrets: [
      SMTP_USER,
      SMTP_PASS,
      ORDER_NOTIFICATION_FROM,
    ],
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      const adminUser = await requireAdmin(req);

      if (req.method === "DELETE") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        if (String(body.confirm || "").trim() !== "DELETE") return jsonError(res, 400, "Type DELETE to confirm customer deletion.");
        const result = await deleteCustomerCompletely({
          uid: String(body.uid || "").trim(),
          email: body.email || "",
          adminUser,
        });
        return res.json(result);
      }

      if (req.method === "GET") {
        const limit = Math.min(500, Math.max(1, Number(req.query.limit || 250)));
        const orderLimit = Math.min(1000, Math.max(limit, Number(req.query.orderLimit || 500)));
        const customersByKey = new Map();
        const customersByEmail = new Map();

        const usersSnap = await db.collection("users").limit(limit).get();
        for (const doc of usersSnap.docs) {
          const customer = publicCustomerFromDoc(doc);
          const emailKey = normalizedEmail(customer.email);
          const existingByEmail = emailKey ? customersByEmail.get(emailKey) : null;
          if (existingByEmail) {
            mergeCustomerProfile(existingByEmail, customer);
            customersByKey.set(customer.key, existingByEmail);
          } else {
            customersByKey.set(customer.key, customer);
            if (emailKey) customersByEmail.set(emailKey, customer);
          }
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
            creatorCollaborator: false,
            collaborationId: "",
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

        const seenCustomers = new Set();
        const customers = [...customersByKey.values()]
          .filter(customer => {
            if (seenCustomers.has(customer)) return false;
            seenCustomers.add(customer);
            return true;
          })
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
        if (req.method === "POST" && body.action === "sendEmail") {
          const result = await sendBulkCustomerEmail({
            adminUser,
            recipients: body.recipients || [],
            subject: body.subject,
            body: body.body,
            coupon: body.coupon || body.couponCode || "",
            language: body.language || "",
          });
          return res.json(result);
        }

	        const uid = String(body.uid || "").trim();
	        if (!uid || uid === "guest") return jsonError(res, 400, "Choose a registered customer.");
	        const name = body.name == null ? null : String(body.name || "").trim().slice(0, 180);
	        const email = body.email == null ? null : normalizedEmail(body.email || "");
	        const phone = body.phone == null ? null : String(body.phone || "").trim().slice(0, 80);
	        const notes = body.notes == null ? null : String(body.notes).slice(0, 5000);
	        const tags = Array.isArray(body.tags)
	          ? body.tags.map(tag => String(tag || "").trim()).filter(Boolean).slice(0, 20)
	          : null;
	        const shippingInput = body.shipping && typeof body.shipping === "object" ? body.shipping : null;
	        const nextCollaborationId = body.collaborationId != null ? String(body.collaborationId || "").trim() : null;
	        if (nextCollaborationId && nextCollaborationId.includes("/")) return jsonError(res, 400, "Invalid collaboration id");
	        const existingUserSnap = await db.collection("users").doc(uid).get();
	        const existingUser = existingUserSnap.exists ? existingUserSnap.data() : {};
	        const update = {
	          createdAt: existingUser.createdAt || now(),
	          updatedAt: now(),
	          updatedBy: adminUser.uid,
	        };
	        if (name != null) {
	          update.name = name;
	          update.displayName = name;
	        }
	        if (email != null) {
	          update.email = email;
	          update.emailLower = email;
	        }
	        if (phone != null) update.phone = phone;
	        if (shippingInput) {
	          const existingShipping = existingUser.shipping && typeof existingUser.shipping === "object" ? existingUser.shipping : {};
	          const existingBoxNow = existingShipping.boxNow && typeof existingShipping.boxNow === "object" ? existingShipping.boxNow : {};
	          const boxNow = shippingInput.boxNow && typeof shippingInput.boxNow === "object" ? shippingInput.boxNow : {};
	          update.shipping = {
	            ...existingShipping,
		            deliveryMethod: String(shippingInput.deliveryMethod || existingShipping.deliveryMethod || "boxnow").trim() || "boxnow",
		            name: String(shippingInput.name || "").trim().slice(0, 180),
		            phone: String(shippingInput.phone || "").trim().slice(0, 80),
		            addressLine1: String(shippingInput.addressLine1 || shippingInput.address || "").trim().slice(0, 240),
		            addressLine2: String(shippingInput.addressLine2 || "").trim().slice(0, 240),
		            postalCode: String(shippingInput.postalCode || shippingInput.zip || "").trim().slice(0, 40),
		            city: String(shippingInput.city || "").trim().slice(0, 120),
		            country: String(shippingInput.country || "").trim().slice(0, 120),
		            boxNow: {
	              ...existingBoxNow,
	              id: String(boxNow.id || "").trim().slice(0, 120),
	              name: String(boxNow.name || "").trim().slice(0, 180),
	              addressLine1: String(boxNow.addressLine1 || "").trim().slice(0, 240),
	              addressLine2: String(boxNow.addressLine2 || "").trim().slice(0, 240),
	              postalCode: String(boxNow.postalCode || "").trim().slice(0, 40),
	              lat: String(boxNow.lat || "").trim().slice(0, 80),
	              lng: String(boxNow.lng || "").trim().slice(0, 80),
	            },
	          };
	        }
	        if (notes != null) update.notes = notes;
	        if (tags) update.tags = tags;
	        if (body.creatorCollaborator != null) update.creatorCollaborator = body.creatorCollaborator === true;
	        if (nextCollaborationId != null) update.collaborationId = nextCollaborationId;
	        const previousCollaborationId = existingUser.collaborationId || "";
        await db.collection("users").doc(uid).set(update, { merge: true });
        if (previousCollaborationId && previousCollaborationId !== nextCollaborationId) {
          const previousRef = db.collection(COLLABORATIONS_COLLECTION).doc(previousCollaborationId);
          const previousSnap = await previousRef.get();
          if (previousSnap.exists && previousSnap.data()?.customerKey === `uid:${uid}`) {
            await previousRef.set({
              customerKey: "",
              updatedAt: now(),
              updatedBy: adminUser.uid,
            }, { merge: true });
          }
        }
        if (update.creatorCollaborator === true && nextCollaborationId) {
          await db.collection(COLLABORATIONS_COLLECTION).doc(nextCollaborationId).set({
            customerKey: `uid:${uid}`,
            updatedAt: now(),
            updatedBy: adminUser.uid,
          }, { merge: true });
        }
        return res.json({ ok: true });
      }

      return jsonError(res, 405, "Use GET, PATCH, POST, or DELETE");
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
        if (String(body.action || "").trim() === "markAllRead") {
          const snap = await db.collection(CHAT_CONVERSATIONS_COLLECTION)
            .where("unreadAdmin", ">", 0)
            .limit(500)
            .get();
          const batch = db.batch();
          snap.docs.forEach(doc => {
            batch.set(doc.ref, {
              unreadAdmin: 0,
              adminLastReadAt: now(),
              updatedAt: now(),
              updatedBy: adminUser.uid,
            }, { merge: true });
          });
          if (!snap.empty) await batch.commit();
          return res.json({ ok: true, updated: snap.size });
        }

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

exports.adminChatbotDraft = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    secrets: [OPENAI_API_KEY],
    cors: ALLOWED_ORIGIN_LIST,
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      await requireAdmin(req);
      if (req.method !== "POST") return jsonError(res, 405, "Use POST");

      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const conversationId = String(body.conversationId || body.id || "").trim();
      if (!conversationId) return jsonError(res, 400, "Missing conversation ID");

      const apiKey = String(OPENAI_API_KEY.value() || "").trim();
      if (!apiKey) return jsonError(res, 400, "missing_openai_api_key");

      const settings = await getChatbotSettings();
      if (settings.enabled !== true || settings.mode === "off") {
        return jsonError(res, 400, "Chatbot is disabled in settings");
      }

      const ref = db.collection(CHAT_CONVERSATIONS_COLLECTION).doc(conversationId);
      const snap = await ref.get();
      if (!snap.exists) return jsonError(res, 404, "Conversation not found");

      const messages = await chatMessagesForConversation(conversationId, settings.maxHistoryMessages, { latest: true });
      if (!messages.some(message => message.sender === "customer" && String(message.text || "").trim())) {
        return jsonError(res, 400, "No customer message found to answer");
      }

      const shipping = await getShippingSettings();
      const boxNow = await getEffectiveBoxNowSettings(req, { forceLocalEnvironment: false });
      const replyLanguage = chatbotReplyLanguageForMessages(messages, settings);
      const input = await buildChatbotDraftInput({
        conversation: publicChatConversation(conversationId, snap.data()),
        messages,
        settings,
        shipping,
        boxNow,
        replyLanguage,
      });

      const client = new OpenAI({ apiKey });
      const model = settings.model || DEFAULT_CHATBOT_SETTINGS.model;
      const response = await client.responses.create({
        model,
        instructions: chatbotDraftInstructions(settings, { replyLanguage }),
        input,
        max_output_tokens: settings.maxOutputTokens,
        store: false,
      });
      const rawDraft = sanitizeChatText(responseTextFromOpenAI(response), 5000);
      const draft = await translateChatbotDraft({
        client,
        model,
        draft: rawDraft,
        replyLanguage,
        maxOutputTokens: settings.maxOutputTokens,
      });
      if (!draft) return jsonError(res, 502, "OpenAI returned an empty draft");

      return res.json({
        ok: true,
        draft,
        replyLanguage,
        configuredReplyLanguage: settings.translation?.replyLanguage || "auto",
        model: response.model || model,
        responseId: response.id || "",
        usage: response.usage || null,
        settings: chatbotSettingsPublic(settings),
      });
    } catch (err) {
      logger.error("Chatbot draft failed", { error: err.message || "Chatbot draft failed" });
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
        const [snap, groupsSnap, postsSnap] = await Promise.all([
          db.collection(SOCIAL_OPPORTUNITIES_COLLECTION).orderBy("scannedAt", "desc").limit(limit).get(),
          db.collection(SOCIAL_GROUPS_COLLECTION).orderBy("name").limit(500).get(),
          db.collection(SOCIAL_POSTS_COLLECTION).orderBy("updatedAt", "desc").limit(500).get(),
        ]);
        const opportunities = snap.docs.map(doc => publicSocialOpportunity(doc.id, doc.data()));
        const groups = groupsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const posts = postsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        return res.json({ settings, opportunities, groups, posts });
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
        if (action === "saveGroup") {
          const group = body.group || {};
          const name = String(group.name || "").trim().slice(0, 180);
          const url = String(group.url || "").trim().slice(0, 2000);
          if (!name || !/^https:\/\/(www\.)?facebook\.com\//i.test(url)) return jsonError(res, 400, "Enter a Facebook group name and URL");
          const id = String(group.id || "").trim() || db.collection(SOCIAL_GROUPS_COLLECTION).doc().id;
          const record = {
            name,
            url,
            audience: String(group.audience || "").trim().slice(0, 500),
            imageUrl: String(group.imageUrl || "").trim().slice(0, 700000),
            products: Array.isArray(group.products) ? group.products.filter(value => ["happy-chicken", "terragrub"].includes(value)) : [],
            active: group.active !== false,
            notes: String(group.notes || "").trim().slice(0, 2000),
            updatedAt: new Date().toISOString(),
            updatedBy: adminUser.uid,
          };
          await db.collection(SOCIAL_GROUPS_COLLECTION).doc(id).set(record, { merge: true });
          return res.json({ ok: true, group: { id, ...record } });
        }
        if (action === "deleteGroup") {
          const id = String(body.id || "").trim();
          if (!id) return jsonError(res, 400, "Missing group id");
          await db.collection(SOCIAL_GROUPS_COLLECTION).doc(id).delete();
          return res.json({ ok: true });
        }
        if (action === "bulkUpdateGroups") {
          const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(value => String(value || "").trim()).filter(value => value && !value.includes("/")))].slice(0, 500);
          if (!ids.length) return jsonError(res, 400, "Select at least one group");
          if (typeof body.active !== "boolean") return jsonError(res, 400, "Missing group status");
          const batch = db.batch();
          for (const id of ids) batch.set(db.collection(SOCIAL_GROUPS_COLLECTION).doc(id), { active: body.active, updatedAt: new Date().toISOString(), updatedBy: adminUser.uid }, { merge: true });
          await batch.commit();
          return res.json({ ok: true, updated: ids.length, active: body.active });
        }
        if (action === "savePost") {
          const post = body.post || {};
          const title = String(post.title || "").trim().slice(0, 180);
          const content = String(post.content || "").trim().slice(0, 10000);
          const platform = ["facebook", "instagram"].includes(post.platform) ? post.platform : "facebook";
          const product = ["happy-chicken", "terragrub"].includes(post.product) ? post.product : "happy-chicken";
          if (!title || !content) return jsonError(res, 400, "Post title and content are required");
          const id = String(post.id || "").trim() || db.collection(SOCIAL_POSTS_COLLECTION).doc().id;
          const record = {
            title,
            content,
            platform,
            product,
            language: ["el", "en"].includes(post.language) ? post.language : "el",
            status: ["draft", "ready", "posted"].includes(post.status) ? post.status : "draft",
            destinationGroupIds: platform === "facebook" && Array.isArray(post.destinationGroupIds) ? post.destinationGroupIds.map(String).slice(0, 500) : [],
            campaign: String(post.campaign || "").trim().replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 100),
            imageUrl: String(post.imageUrl || "").trim().slice(0, 2000),
            notes: String(post.notes || "").trim().slice(0, 2000),
            postedDestinations: Array.isArray(post.postedDestinations) ? post.postedDestinations.slice(0, 1000) : [],
            updatedAt: new Date().toISOString(),
            updatedBy: adminUser.uid,
          };
          await db.collection(SOCIAL_POSTS_COLLECTION).doc(id).set(record, { merge: true });
          return res.json({ ok: true, post: { id, ...record } });
        }
        if (action === "deletePost") {
          const id = String(body.id || "").trim();
          if (!id) return jsonError(res, 400, "Missing post id");
          await db.collection(SOCIAL_POSTS_COLLECTION).doc(id).delete();
          return res.json({ ok: true });
        }
        return jsonError(res, 400, "Unknown Marketing action");
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
      if (!expectedSecret) return jsonError(res, 503, "Marketing webhook secret is not configured");

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
      logger.error("Marketing webhook failed", { error: err.message || "Webhook failed" });
      return jsonError(res, Number(err.status || 400), err.message || "Marketing webhook failed");
    }
  }
);

exports.adminCollaborations = onRequest(
  {
    region: "europe-west1",
    invoker: "public",
    cors: ALLOWED_ORIGIN_LIST,
    secrets: [OPENAI_API_KEY],
  },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      const adminUser = await requireAdmin(req);

      if (req.method === "GET") {
        const limit = Math.min(200, Math.max(1, Number(req.query.limit || 100)));
        const snap = await db.collection(COLLABORATIONS_COLLECTION)
          .orderBy("updatedAt", "desc")
          .limit(limit)
          .get();
        const collaborations = snap.docs.map(doc => publicCollaboration(doc.id, doc.data()));
        const metricsByCode = await collaborationMetricsMap(collaborations);
        for (const collaboration of collaborations) {
          const code = normalizeCouponCode(collaboration.offer?.couponCode || "");
          const referral = normalizeReferralCode(collaboration.referralCode || "");
          const key = `${code}::${referral}`;
          collaboration.metrics = code || referral
            ? metricsByCode.get(key) || collaborationMetrics(collaboration, [])
            : null;
        }
        return res.json({ collaborations });
      }

      if (req.method === "DELETE") {
        const id = String(req.query.id || "").trim();
        if (!id) return jsonError(res, 400, "Missing collaboration id");
        await db.collection(COLLABORATIONS_COLLECTION).doc(id).delete();
        return res.json({ ok: true });
      }

      if (req.method === "POST" || req.method === "PATCH") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const action = String(body.action || "save").trim();

        if (action === "generateOutreach") {
          const apiKey = String(OPENAI_API_KEY.value() || "").trim();
          if (!apiKey) return jsonError(res, 400, "missing_openai_api_key");
          const id = String(body.id || "").trim();
          let collaboration = null;
          if (id) {
            const snap = await db.collection(COLLABORATIONS_COLLECTION).doc(id).get();
            if (!snap.exists) return jsonError(res, 404, "Collaboration not found");
            collaboration = publicCollaboration(snap.id, snap.data());
          } else {
            collaboration = sanitizeCollaborationInput(body.collaboration || body);
          }
          const settings = await getChatbotSettings();
          const model = String(body.model || settings.model || DEFAULT_CHATBOT_SETTINGS.model);
          const client = new OpenAI({ apiKey });
          const draft = await generateCollaborationOutreach({
            client,
            model,
            collaboration,
            language: String(body.language || "auto"),
            channel: String(body.channel || "dm"),
          });
          if (!draft) return jsonError(res, 502, "OpenAI returned an empty outreach draft");
          return res.json({ ok: true, draft, model });
        }

        if (action === "delete") {
          const id = String(body.id || "").trim();
          if (!id) return jsonError(res, 400, "Missing collaboration id");
          await db.collection(COLLABORATIONS_COLLECTION).doc(id).delete();
          return res.json({ ok: true });
        }

        const id = String(body.id || body.collaboration?.id || "").trim();
        const ref = id
          ? db.collection(COLLABORATIONS_COLLECTION).doc(id)
          : db.collection(COLLABORATIONS_COLLECTION).doc();
        const existingSnap = await ref.get();
        const existing = existingSnap.exists ? existingSnap.data() : {};
        const sanitized = sanitizeCollaborationInput(body.collaboration || body, existing);
        if (!sanitized.name) return jsonError(res, 400, "Enter a collaboration name");
        const update = {
          ...sanitized,
          createdAt: existing.createdAt || now(),
          updatedAt: now(),
          updatedBy: adminUser.uid,
        };
        await ref.set(update, { merge: true });
        const updatedSnap = await ref.get();
        const collaboration = publicCollaboration(ref.id, updatedSnap.data());
        const code = normalizeCouponCode(collaboration.offer?.couponCode || "");
        const referral = normalizeReferralCode(collaboration.referralCode || "");
        if (code || referral) {
          const metricsByCode = await collaborationMetricsMap([collaboration]);
          collaboration.metrics = metricsByCode.get(`${code}::${referral}`) || collaborationMetrics(collaboration, []);
        }
        return res.json({ ok: true, collaboration });
      }

      return jsonError(res, 405, "Use GET, POST, PATCH, or DELETE");
    } catch (err) {
      logger.error("Collaborations admin failed", { error: err.message || "Collaborations failed" });
      return adminError(res, err);
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
        const chatbot = await getChatbotSettings();
        const marketing = await getMarketingSettings();
        return res.json({ shipping, stripe, orderEmails, boxNow, chatbot, marketing });
      }

      if (req.method === "PATCH" || req.method === "POST") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        if (body.action === "sendOrderStatusTestEmail") {
          const result = await sendOrderStatusTestEmail(body.template || {}, adminUser, body.language || "", body.placeholders || body.orderEmails?.placeholders || null);
          return res.json({ ok: true, result });
        }

        let shipping = null;
        let stripe = null;
        let orderEmails = null;
        let boxNow = null;
        let chatbot = null;
        let marketing = null;

        if (
          body.shipping ||
          body.boxnowFeeOverrideEnabled != null ||
          body.boxnowFeeOverrideCents != null ||
          body.boxnowFeeDiscountEnabled != null ||
          body.boxnowFeeDiscountCents != null ||
          body.boxnowParcelPrices != null
        ) {
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

        if (body.chatbot) {
          const previous = await getChatbotSettings();
          chatbot = sanitizeChatbotSettings(body.chatbot, previous);
          await db.doc(CHATBOT_SETTINGS_DOC).set(
            {
              ...chatbot,
              updatedBy: adminUser.uid,
            },
            { merge: true }
          );
        }

        if (body.marketing) {
          const previous = await getMarketingSettings();
          marketing = sanitizeMarketingSettings(body.marketing, previous);
          await db.doc(MARKETING_SETTINGS_DOC).set(
            {
              ...marketing,
              updatedBy: adminUser.uid,
            },
            { merge: true }
          );
        }

        if (!shipping) shipping = await getShippingSettings();
        if (!stripe) stripe = await effectiveStripeSettings(req, { forceLocalEnvironment: false });
        if (!orderEmails) orderEmails = await getOrderEmailSettings();
        if (!boxNow) boxNow = await getEffectiveBoxNowSettings(req, { forceLocalEnvironment: false });
        if (!chatbot) chatbot = await getChatbotSettings();
        if (!marketing) marketing = await getMarketingSettings();
        return res.json({ ok: true, shipping, stripe, orderEmails, boxNow, chatbot, marketing });
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

  if (action === "fetchBulkOrderLabels") {
    const orderIds = [...new Set((Array.isArray(body.orderIds) ? body.orderIds : [])
      .map(value => String(value || "").trim()).filter(Boolean))];
    if (!orderIds.length) throw new Error("Select at least one order");
    if (orderIds.length > 50) throw new Error("Select no more than 50 orders at a time");

    const snapshots = await Promise.all(orderIds.map(id => db.collection("orders").doc(id).get()));
    const missing = snapshots.filter(snapshot => !snapshot.exists).map(snapshot => snapshot.id);
    if (missing.length) throw new Error(`Orders not found: ${missing.join(", ")}`);
    const ordersToPrint = snapshots.map(snapshot => ({ id: snapshot.id, ...snapshot.data() }));
    const tokenPromises = new Map();
    const brandedLabels = await Promise.all(ordersToPrint.map(async order => {
      const shipment = order.boxNowShipment || {};
      const environment = sanitizeBoxNowEnvironment(shipment.environment || settings.activeEnvironment);
      const orderConfig = boxNowEnvConfig(settings, environment);
      if (!tokenPromises.has(environment)) tokenPromises.set(environment, getBoxNowAccessToken(orderConfig));
      const { token } = await tokenPromises.get(environment);
      const requestIds = [
        shipment.deliveryRequestId,
        ...(Array.isArray(shipment.deliveryRequestIds) ? shipment.deliveryRequestIds : []),
        order.orderNumber,
      ].map(value => String(value || "").trim()).filter(Boolean);
      const parcelId = Array.isArray(shipment.parcelIds) ? String(shipment.parcelIds[0] || "").trim() : "";
      if (!requestIds.length && !parcelId) throw new Error(`${order.orderNumber || order.id} has no BOX NOW shipment`);

      let response = null;
      for (const id of requestIds) {
        response = await boxNowApiRequest(orderConfig, `/api/v1/delivery-requests/${encodeURIComponent(id)}/label.pdf`, {
          raw: true,
          token,
          headers: { accept: "application/pdf" },
        });
        if (response.ok) break;
      }
      if ((!response || !response.ok) && parcelId) {
        response = await boxNowApiRequest(orderConfig, `/api/v1/parcels/${encodeURIComponent(parcelId)}/label.pdf`, {
          raw: true,
          token,
          headers: { accept: "application/pdf" },
        });
      }
      if (!response?.ok || !response.buffer) {
        throw new Error(`BOX NOW label unavailable for ${order.orderNumber || order.id} (${response?.status || "unknown"})`);
      }
      return brandBoxNowLabelPdf(response.buffer);
    }));

    const combined = await composeA4BoxNowLabels(brandedLabels, { labelWidthCm: 9 });
    return {
      ok: true,
      action,
      result: compactBoxNowResult({ ok: true, status: 200, contentType: "application/pdf", buffer: combined.buffer }),
      layout: combined.layout,
      orderNumbers: ordersToPrint.map(order => order.orderNumber || order.id),
    };
  }

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
        paymentMode: body.paymentMode || "",
        compartmentSize: body.compartmentSize,
        amountToBeCollectedCents: body.amountToBeCollectedCents,
        req,
      }, adminUser),
    };
  }

  if (action === "buildOrderDeliveryPayload") {
    const orderId = String(body.orderId || "").trim();
    if (!orderId) throw new Error("Missing order ID");
    const snap = await db.collection("orders").doc(orderId).get();
    if (!snap.exists) throw new Error("Order not found");
    const order = { id: snap.id, ...snap.data() };
    const productsMap = await getProductsMap({ includeInactive: true });
    const destinationEmail = await resolveBoxNowDestinationEmail(order);
    return {
      ok: true,
      action,
      environment: safeEnvironment,
      result: buildBoxNowDeliveryRequest(order, config, productsMap, {
        paymentMode: body.paymentMode || "",
        compartmentSize: body.compartmentSize,
        amountToBeCollectedCents: body.amountToBeCollectedCents,
        destinationEmail,
      }),
    };
  }

  if (action === "verifyWebhookSample") {
    const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
    const verified = verifyBoxNowWebhookPayload(JSON.stringify(payload), payload, config.webhookSecret);
    return { ok: true, action, environment: safeEnvironment, result: verified };
  }

  if (action === "createStagingTestDelivery") {
    const stageConfig = boxNowEnvConfig(settings, "stage");
    const productsMap = await getProductsMap();
    const testProductId = Object.keys(productsMap).find(id => productsMap[id]?.active !== false);
    if (!testProductId) throw new Error("Create or activate at least one product before generating a staging test parcel");
    if (!stageConfig.originContactNumber) throw new Error("Set the staging BOX NOW origin phone before generating a test parcel");

    const testOrder = await createManualOrderFromAdmin({
      orderNumber: `BOXNOW-TEST-${Date.now()}`,
      customer: {
        name: "GRUBZ BOX NOW Test",
        email: stageConfig.originContactEmail || GRUBZ_INFO_EMAIL,
        phone: stageConfig.originContactNumber,
      },
      shipping: {
        deliveryMethod: "boxnow",
        name: "GRUBZ BOX NOW Test",
        phone: stageConfig.originContactNumber,
        boxNow: {
          id: BOXNOW_STAGE_TEST_DESTINATION_LOCATION_ID,
          name: "BOX NOW staging test locker",
        },
      },
      items: [{ id: testProductId, qty: 1 }],
      amountTotalOverride: 0,
      status: "test",
      paymentStatus: "test",
      notes: "Automatically generated BOX NOW staging webhook test order. Do not fulfill.",
    }, adminUser);

    let shipment;
    try {
      shipment = await createBoxNowDeliveryForOrder(testOrder.id, {
        environment: "stage",
        paymentMode: "prepaid",
        compartmentSize: 2,
        amountToBeCollectedCents: 0,
        req,
      }, adminUser);
    } catch (err) {
      await db.collection("orders").doc(testOrder.id).set({
        boxNowTestCreationError: err.message || "Staging delivery creation failed",
        updatedAt: now(),
      }, { merge: true });
      throw err;
    }

    const parcelId = String(shipment.parcelIds?.[0] || "").trim();
    let voucher = null;
    let voucherError = "";
    if (parcelId) {
      const { token: stageToken } = await getBoxNowAccessToken(stageConfig);
      const labelResponse = await boxNowApiRequest(
        stageConfig,
        `/api/v1/parcels/${encodeURIComponent(parcelId)}/label.pdf`,
        { raw: true, token: stageToken, headers: { accept: "application/pdf" } }
      );
      if (labelResponse.ok) {
        const prepared = await prepareA4BoxNowLabelPdf(labelResponse.buffer);
        labelResponse.buffer = prepared.buffer;
        labelResponse.contentType = "application/pdf";
        voucher = compactBoxNowResult(labelResponse);
      }
      else voucherError = `Voucher could not be downloaded (${labelResponse.status})`;
    } else {
      voucherError = "BOX NOW created the delivery request without returning a parcel ID";
    }

    return {
      ok: true,
      action,
      environment: "stage",
      activeEnvironmentUnchanged: settings.activeEnvironment,
      order: {
        id: testOrder.id,
        orderNumber: testOrder.orderNumber,
        productId: testProductId,
      },
      shipment,
      parcelId,
      voucher,
      voucherError,
    };
  }

  if (action === "webhookStatus") {
    const webhookUrl = `${GRUBZ_URL}/api/boxnow/webhook/${safeEnvironment}`;
    const healthSnap = await db.collection("boxNowWebhookHealth").doc(safeEnvironment).get();
    const health = healthSnap.exists ? healthSnap.data() : null;
    const [attemptsSnap, verifiedSnap] = await Promise.all([
      db.collection("boxNowWebhookAttempts").doc(safeEnvironment).collection("attempts")
        .orderBy("receivedAt", "desc").limit(50).get(),
      db.collection("boxNowWebhookEvents").orderBy("receivedAt", "desc").limit(50).get(),
    ]);
    const attempts = attemptsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    const recordedEventIds = new Set(attempts.map(item => String(item.eventId || "")).filter(Boolean));
    const legacyVerifiedAttempts = verifiedSnap.docs
      .map(doc => ({ id: doc.id, ...(doc.data() || {}) }))
      .filter(item => String(item.parsed?.environment || "") === safeEnvironment && !recordedEventIds.has(item.id))
      .map(item => ({
        id: `event_${item.id}`,
        receivedAt: item.receivedAt || null,
        method: "POST",
        httpStatus: 200,
        outcome: "verified",
        verificationReason: "verified",
        eventId: item.id,
        event: item.parsed?.event || "",
        orderNumber: item.parsed?.orderNumber || "",
        parcelId: item.parsed?.parcelId || "",
        historical: true,
      }));
    const webhookAttempts = [...attempts, ...legacyVerifiedAttempts]
      .sort((a, b) => millisFromTimestamp(b.receivedAt) - millisFromTimestamp(a.receivedAt))
      .slice(0, 50);
    return {
      ok: true,
      action,
      environment: safeEnvironment,
      webhookUrl,
      webhookSecretConfigured: Boolean(config.webhookSecret),
      registrationManagedBy: "BOX NOW",
      lastVerifiedEvent: health ? {
        eventId: health.eventId || "",
        event: health.event || "",
        orderNumber: health.orderNumber || "",
        parcelId: health.parcelId || "",
        eventTime: health.eventTime || "",
        receivedAt: health.receivedAt || null,
      } : null,
      webhookAttempts,
      attemptRetentionStarted: attempts.length ? attempts[attempts.length - 1].receivedAt || null : null,
    };
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
    const parcelId = String(body.parcelId || "").trim();
    const orderCandidates = [
      body.deliveryRequestId,
      body.orderNumber,
      ...(Array.isArray(body.deliveryRequestIds) ? body.deliveryRequestIds : []),
    ].map(value => String(value || "").trim()).filter(Boolean);
    const ids = action === "fetchOrderLabel" ? orderCandidates : [parcelId || String(body.orderNumber || "").trim()].filter(Boolean);
    if (!ids.length) throw new Error(action === "fetchOrderLabel" ? "Enter an order number" : "Enter a parcel ID");
    let response = null;
    let labelId = "";
    for (const id of ids) {
      const path = action === "fetchOrderLabel"
        ? `/api/v1/delivery-requests/${encodeURIComponent(id)}/label.${type}`
        : `/api/v1/parcels/${encodeURIComponent(id)}/label.${type}`;
      response = await boxNowApiRequest(config, path, {
        raw: true,
        token,
        headers: { accept: type === "pdf" ? "application/pdf" : "text/plain" },
      });
      labelId = id;
      if (response.ok) break;
    }
    let source = action === "fetchOrderLabel" ? "order" : "parcel";
    if (action === "fetchOrderLabel" && response && !response.ok && response.status === 404 && parcelId) {
      response = await boxNowApiRequest(config, `/api/v1/parcels/${encodeURIComponent(parcelId)}/label.${type}`, {
        raw: true,
        token,
        headers: { accept: type === "pdf" ? "application/pdf" : "text/plain" },
      });
      labelId = parcelId;
      source = "parcel-fallback";
    }
    if (type === "pdf" && response?.ok && response.buffer) {
      const prepared = await prepareA4BoxNowLabelPdf(response.buffer);
      response.buffer = prepared.buffer;
      response.contentType = "application/pdf";
      response.layout = prepared.layout;
    }
    return { ok: response.ok, action, environment: safeEnvironment, labelId, source, result: compactBoxNowResult(response) };
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

exports.marketingEvents = onRequest(
  { region: "europe-west1", invoker: "public", cors: ALLOWED_ORIGIN_LIST },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method !== "POST") return jsonError(res, 405, "Use POST");
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const action = String(body.action || "").trim();
      const email = normalizedEmail(body.email || body.customer?.email || "");
      const sessionId = marketingSessionId(body.sessionId || "");
      const createdAt = now();
      const common = {
        email,
        name: String(body.name || body.customer?.name || "").trim().slice(0, 180),
        phone: String(body.phone || body.customer?.phone || "").trim().slice(0, 80),
        source: String(body.source || action || "website").trim().slice(0, 80),
        language: String(body.language || "").trim().slice(0, 20),
        sessionId,
        userAgent: String(req.get("user-agent") || "").slice(0, 500),
        referrer: String(body.referrer || req.get("referer") || "").slice(0, 500),
        updatedAt: createdAt,
      };

      if (action === "first_order_offer") {
        if (!email) return jsonError(res, 400, "Enter a valid email address");
        const marketing = await getMarketingSettings();
        const couponCode = normalizeCouponCode(body.couponCode || marketing.firstOrderOffer?.couponCode || "WELCOME10");
        const id = marketingDocId("lead", email);
        const ref = db.collection(MARKETING_LEADS_COLLECTION).doc(id);
        const snap = await ref.get();
        await ref.set({
          ...common,
          couponCode,
          status: snap.exists ? (snap.data()?.status || "captured") : "captured",
          createdAt: snap.exists ? (snap.data()?.createdAt || createdAt) : createdAt,
        }, { merge: true });
        return res.json({ ok: true, lead: publicMarketingRecord(id, { ...(snap.data() || {}), ...common, couponCode, status: "captured" }) });
      }

      if (action === "abandoned_cart" || action === "checkout_started" || action === "cart_cleared") {
        const cartItems = marketingCartItems(body.items || body.cartItems || []);
        if (!email && !sessionId) return jsonError(res, 400, "Missing cart identity");
        const id = marketingDocId("cart", email || sessionId);
        const ref = db.collection(ABANDONED_CARTS_COLLECTION).doc(id);
        const snap = await ref.get();
        const status = action === "checkout_started"
          ? "checkout_started"
          : action === "cart_cleared"
            ? "cleared"
            : "active";
        await ref.set({
          ...common,
          status,
          cartItems,
          cartValueCents: Math.max(0, Math.round(Number(body.cartValueCents || body.cartValue || 0))),
          couponCode: normalizeCouponCode(body.couponCode || ""),
          createdAt: snap.exists ? (snap.data()?.createdAt || createdAt) : createdAt,
          lastCartAt: createdAt,
        }, { merge: true });
        return res.json({ ok: true, cart: publicMarketingRecord(id, { ...(snap.data() || {}), ...common, status, cartItems }) });
      }

      return jsonError(res, 400, "Unknown marketing action");
    } catch (err) {
      logger.warn("marketingEvents failed", err);
      return jsonError(res, err.status || 400, err.message || "Marketing event failed");
    }
  }
);

exports.adminAbandonedCarts = onRequest(
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
        const limit = Math.min(250, Math.max(1, Number(req.query.limit || 100)));
        const status = String(req.query.status || "").trim().toLowerCase();
        const snap = await db.collection(ABANDONED_CARTS_COLLECTION).orderBy("lastCartAt", "desc").limit(limit).get();
        const carts = snap.docs
          .map(doc => publicMarketingRecord(doc.id, doc.data()))
          .filter(cart => !status || status === "all" || cart.status === status);
        return res.json({ carts });
      }

      if (req.method === "PATCH") {
        const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
        const id = String(body.id || "").trim();
        if (!id) return jsonError(res, 400, "Missing abandoned cart id");
        const allowedStatuses = new Set(["active", "checkout_started", "cleared", "contacted", "recovered", "dismissed"]);
        const status = String(body.status || "").trim().toLowerCase();
        if (status && !allowedStatuses.has(status)) return jsonError(res, 400, "Invalid abandoned cart status");
        const notes = String(body.notes || "").trim().slice(0, 2000);
        const update = {
          updatedAt: now(),
          updatedBy: adminUser.uid,
        };
        if (status) {
          update.status = status;
          if (status === "contacted") update.contactedAt = now();
          if (status === "recovered") update.recoveredAt = now();
          if (status === "dismissed") update.dismissedAt = now();
        }
        if (body.notes != null) update.notes = notes;
        await db.collection(ABANDONED_CARTS_COLLECTION).doc(id).set(update, { merge: true });
        const snap = await db.collection(ABANDONED_CARTS_COLLECTION).doc(id).get();
        return res.json({ ok: true, cart: publicMarketingRecord(snap.id, snap.data() || {}) });
      }

      return jsonError(res, 405, "Use GET or PATCH");
    } catch (err) {
      logger.error("adminAbandonedCarts failed", { error: err.message || "Abandoned carts failed" });
      return adminError(res, err);
    }
  }
);

exports.trackEvent = onRequest(
  { region: "europe-west1", invoker: "public", cors: ALLOWED_ORIGIN_LIST },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      if (req.method !== "POST") return jsonError(res, 405, "Use POST");
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const event = sanitizeAnalyticsEvent(body);
      const createdAt = now();
      const day = analyticsDayKey(new Date());
      const userAgent = analyticsSafeString(req.get("user-agent") || "", 500);
      await db.collection(ANALYTICS_EVENTS_COLLECTION).add({
        ...event,
        day,
        createdAt,
        userAgent,
      });
      const sessionRef = db.collection(ANALYTICS_SESSIONS_COLLECTION).doc(event.sessionId);
      await db.runTransaction(async tx => {
        const sessionDoc = await tx.get(sessionRef);
        tx.set(sessionRef, {
          sessionId: event.sessionId,
          firstSeenAt: sessionDoc.exists ? (sessionDoc.data()?.firstSeenAt || createdAt) : createdAt,
          lastSeenAt: createdAt,
          lastEvent: event.event,
          lastPage: event.page,
          language: event.language,
          device: event.device,
          referrer: event.referrer,
          attribution: event.attribution,
          eventCount: FieldValue.increment(1),
        }, { merge: true });
      });
      return res.json({ ok: true });
    } catch (err) {
      logger.warn("trackEvent failed", err);
      return jsonError(res, err.status || 400, err.message || "Analytics event failed");
    }
  }
);

exports.adminAnalytics = onRequest(
  { region: "europe-west1", invoker: "public", cors: ALLOWED_ORIGIN_LIST },
  async (req, res) => {
    try {
      if (req.method === "OPTIONS") return res.status(204).end();
      await requireAdmin(req);
      const range = String(req.query.range || "30").trim();
      const days = range === "all" ? 3650 : Math.min(365, Math.max(1, Number(range || 30)));
      const cutoff = new Date();
      cutoff.setHours(0, 0, 0, 0);
      cutoff.setDate(cutoff.getDate() - days + 1);
      const snap = await db.collection(ANALYTICS_EVENTS_COLLECTION)
        .where("createdAt", ">=", Timestamp.fromDate(cutoff))
        .orderBy("createdAt", "desc")
        .limit(2000)
        .get();
      const events = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const sessions = new Set();
      const eventMap = new Map();
      const pageMap = new Map();
      const referrerMap = new Map();
      const trafficSourceMap = new Map();
      const campaignMap = new Map();
      const deviceMap = new Map();
      const productMap = new Map();
      const dailyMap = new Map();
      const durationMap = new Map();
      const sessionMap = new Map();
      const funnelKeys = [
        "page_view",
        "section_view",
        "product_view",
        "add_to_cart",
        "cart_open",
        "checkout_start",
        "address_saved",
        "review_open",
        "boxnow_locker_selected",
        "checkout_submit",
        "checkout_success",
        "chat_open",
        "chat_message_sent",
      ];
      const funnel = Object.fromEntries(funnelKeys.map(key => [key, { events: 0, sessions: new Set() }]));
      const orderedEvents = [...events].sort((a, b) => millisFromTimestamp(a.createdAt) - millisFromTimestamp(b.createdAt));
      for (const event of orderedEvents) {
        sessions.add(event.sessionId);
        addAnalyticsBreakdown(eventMap, event.event);
        addAnalyticsBreakdown(pageMap, event.page || event.path || "/");
        if (event.device) addAnalyticsBreakdown(deviceMap, event.device);
        if (event.props?.productId || event.props?.productName) {
          addAnalyticsBreakdown(productMap, event.props.productName || event.props.productId);
        }
        const day = event.day || analyticsDayKey(millisFromTimestamp(event.createdAt));
        const dayRow = dailyMap.get(day) || { day, events: 0, sessions: new Set() };
        dayRow.events += 1;
        dayRow.sessions.add(event.sessionId);
        dailyMap.set(day, dayRow);
        if (!funnel[event.event]) funnel[event.event] = { events: 0, sessions: new Set() };
        funnel[event.event].events += 1;
        funnel[event.event].sessions.add(event.sessionId);
        const createdMs = millisFromTimestamp(event.createdAt);
        const sessionId = String(event.sessionId || "");
        if (sessionId) {
          const session = sessionMap.get(sessionId) || {
            sessionId,
            firstSeenAt: event.createdAt || null,
            lastSeenAt: event.createdAt || null,
            firstMs: createdMs,
            lastMs: createdMs,
            eventCount: 0,
            device: event.device || "",
            language: event.language || "",
            referrer: event.referrer || "",
            attribution: event.attribution || {},
            firstPage: event.page || event.path || "",
            lastPage: event.page || event.path || "",
            lastEvent: event.event,
            timeline: [],
            reached: new Set(),
          };
          session.eventCount += 1;
          if (!session.firstMs || (createdMs && createdMs < session.firstMs)) {
            session.firstMs = createdMs;
            session.firstSeenAt = event.createdAt || session.firstSeenAt;
            session.firstPage = event.page || event.path || session.firstPage;
          }
          if (createdMs >= session.lastMs) {
            session.lastMs = createdMs;
            session.lastSeenAt = event.createdAt || session.lastSeenAt;
            session.lastPage = event.page || event.path || session.lastPage;
            session.lastEvent = event.event;
          }
          session.device = session.device || event.device || "";
          session.language = session.language || event.language || "";
          session.referrer = session.referrer || event.referrer || "";
          if (!session.attribution?.source && event.attribution?.source) session.attribution = event.attribution;
          session.reached.add(event.event);
          if (session.timeline.length < 24 && event.event !== "engagement_time") {
            session.timeline.push({
              event: event.event,
              page: event.page || "",
              createdAt: event.createdAt || null,
              props: event.props || {},
            });
          }
          sessionMap.set(sessionId, session);
        }
        if (event.event === "engagement_time") {
          const durationMs = Math.max(0, Math.min(15 * 60 * 1000, Number(event.props?.durationMs || 0)));
          if (durationMs > 0) {
            const label = analyticsSafeString(event.props?.section || event.page || event.path || "Unknown", 160) || "Unknown";
            const row = durationMap.get(label) || { label, count: 0, totalMs: 0 };
            row.count += 1;
            row.totalMs += durationMs;
            durationMap.set(label, row);
          }
        }
      }
      for (const session of sessionMap.values()) {
        addAnalyticsBreakdown(referrerMap, session.referrer || "Direct / unknown");
        addAnalyticsBreakdown(trafficSourceMap, session.attribution?.source || session.referrer || "Direct / unknown");
        if (session.attribution?.campaign) addAnalyticsBreakdown(campaignMap, session.attribution.campaign);
      }
      const primaryFunnel = ["page_view", "product_view", "add_to_cart", "cart_open", "checkout_start", "review_open", "checkout_submit", "checkout_success"];
      const funnelRows = primaryFunnel.map(event => ({
        event,
        events: funnel[event]?.events || 0,
        sessions: funnel[event]?.sessions.size || 0,
      }));
      const dropoffs = funnelRows.slice(0, -1).map((row, index) => {
        const next = funnelRows[index + 1];
        const from = Number(row.sessions || 0);
        const to = Math.min(from, Number(next.sessions || 0));
        return {
          from: row.event,
          to: next.event,
          sessions: from,
          continued: to,
          dropped: Math.max(0, from - to),
          conversion: from ? Math.round((to / from) * 1000) / 10 : 0,
        };
      });
      const sessionRows = [...sessionMap.values()]
        .map(session => {
          const reached = primaryFunnel.filter(step => session.reached.has(step));
          const dropOffStep = reached.length ? reached[reached.length - 1] : session.lastEvent;
          return {
            sessionId: session.sessionId.slice(0, 10),
            firstSeenAt: session.firstSeenAt,
            lastSeenAt: session.lastSeenAt,
            durationMs: Math.max(0, (session.lastMs || 0) - (session.firstMs || 0)),
            eventCount: session.eventCount,
            device: session.device,
            language: session.language,
            referrer: session.referrer,
            firstPage: session.firstPage,
            lastPage: session.lastPage,
            lastEvent: session.lastEvent,
            dropOffStep,
            timeline: session.timeline,
          };
        })
        .sort((a, b) => millisFromTimestamp(b.lastSeenAt) - millisFromTimestamp(a.lastSeenAt))
        .slice(0, 30);
      const gameEvents = orderedEvents.filter(event => String(event.event || "").startsWith("happy_chicken_run_"));
      const gameEventMap = new Map();
      const gameCollisionMap = new Map();
      const gameControlMap = new Map();
      const gameDailyMap = new Map();
      const gameSessions = new Set();
      const gameRuns = new Set();
      const completedRuns = [];
      const gameFunnelKeys = [
        "happy_chicken_run_viewed",
        "happy_chicken_run_started",
        "happy_chicken_run_game_over",
        "happy_chicken_run_replay_clicked",
        "happy_chicken_run_shop_clicked",
      ];
      const gameFunnel = Object.fromEntries(gameFunnelKeys.map(key => [key, { events: 0, sessions: new Set() }]));
      for (const event of gameEvents) {
        const props = event.props || {};
        addAnalyticsBreakdown(gameEventMap, event.event);
        gameSessions.add(event.sessionId);
        if (props.run_id) gameRuns.add(props.run_id);
        if (gameFunnel[event.event]) {
          gameFunnel[event.event].events += 1;
          gameFunnel[event.event].sessions.add(event.sessionId);
        }
        const day = event.day || analyticsDayKey(millisFromTimestamp(event.createdAt));
        const dayRow = gameDailyMap.get(day) || { day, events: 0, sessions: new Set(), starts: 0, completions: 0 };
        dayRow.events += 1;
        dayRow.sessions.add(event.sessionId);
        if (["happy_chicken_run_started", "happy_chicken_run_restarted"].includes(event.event)) dayRow.starts += 1;
        if (event.event === "happy_chicken_run_game_over") {
          dayRow.completions += 1;
          completedRuns.push(props);
          addAnalyticsBreakdown(gameCollisionMap, props.collision_type || "unknown");
          try {
            const controls = JSON.parse(props.controls || "{}");
            for (const [control, count] of Object.entries(controls)) addAnalyticsBreakdown(gameControlMap, control, count);
          } catch (_) {}
        }
        gameDailyMap.set(day, dayRow);
      }
      const gameTotal = key => gameEvents.filter(event => event.event === key).length;
      const gameSum = key => completedRuns.reduce((sum, run) => sum + Number(run[key] || 0), 0);
      const gameAverage = key => completedRuns.length ? Math.round((gameSum(key) / completedRuns.length) * 10) / 10 : 0;
      const gameStarts = gameTotal("happy_chicken_run_started") + gameTotal("happy_chicken_run_restarted");
      const gameAnalytics = {
        eventCount: gameEvents.length,
        sessionCount: gameSessions.size,
        runCount: gameRuns.size || gameStarts,
        starts: gameStarts,
        completions: completedRuns.length,
        completionRate: gameStarts ? Math.round((completedRuns.length / gameStarts) * 1000) / 10 : 0,
        replays: gameTotal("happy_chicken_run_replay_clicked"),
        abandoned: gameTotal("happy_chicken_run_abandoned"),
        personalBests: gameTotal("happy_chicken_run_personal_best"),
        shopClicks: gameTotal("happy_chicken_run_shop_clicked"),
        avgScore: gameAverage("score"),
        highScore: completedRuns.reduce((max, run) => Math.max(max, Number(run.score || 0)), 0),
        avgSurvivalSeconds: gameAverage("survival_time"),
        avgTreats: gameAverage("treats_collected"),
        totalTreats: gameSum("treats_collected"),
        avgJumps: gameAverage("jumps"),
        avgDucks: gameAverage("ducks"),
        avgObstaclesPassed: gameAverage("obstacles_passed"),
        avgPauses: gameAverage("pauses"),
        funnel: gameFunnelKeys.map(event => ({ event, events: gameFunnel[event].events, sessions: gameFunnel[event].sessions.size })),
        events: analyticsMapRows(gameEventMap, 30),
        collisions: analyticsMapRows(gameCollisionMap, 12),
        controls: analyticsMapRows(gameControlMap, 12),
        daily: [...gameDailyMap.values()].map(row => ({ day: row.day, events: row.events, sessions: row.sessions.size, starts: row.starts, completions: row.completions })).sort((a, b) => a.day.localeCompare(b.day)),
        recent: [...gameEvents].reverse().slice(0, 20).map(event => ({ event: event.event, sessionId: String(event.sessionId || "").slice(0, 10), createdAt: event.createdAt || null, props: event.props || {} })),
      };
      return res.json({
        ok: true,
        range,
        eventCount: events.length,
        sessionCount: sessions.size,
        events: analyticsMapRows(eventMap, 16),
        pages: analyticsMapRows(pageMap, 16),
        referrers: analyticsMapRows(referrerMap, 12),
        trafficSources: analyticsMapRows(trafficSourceMap, 12),
        campaigns: analyticsMapRows(campaignMap, 12),
        devices: analyticsMapRows(deviceMap, 8),
        products: analyticsMapRows(productMap, 12),
        timeSpent: [...durationMap.values()]
          .map(row => ({ label: row.label, count: row.count, totalMs: row.totalMs, avgMs: row.count ? Math.round(row.totalMs / row.count) : 0 }))
          .sort((a, b) => Number(b.totalMs || 0) - Number(a.totalMs || 0))
          .slice(0, 12),
        dropoffs,
        sessions: sessionRows,
        funnel: Object.entries(funnel).map(([event, row]) => ({ event, events: row.events, sessions: row.sessions.size })),
        daily: [...dailyMap.values()]
          .map(row => ({ day: row.day, events: row.events, sessions: row.sessions.size }))
          .sort((a, b) => a.day.localeCompare(b.day)),
        recent: events.slice(0, 40).map(event => ({
          id: event.id,
          event: event.event,
          page: event.page || "",
          sessionId: String(event.sessionId || "").slice(0, 10),
          createdAt: event.createdAt || null,
          props: event.props || {},
        })),
        game: gameAnalytics,
      });
    } catch (err) {
      return adminError(res, err);
    }
  }
);

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

function boxNowTrackingUpdateFromEvent(payload = {}, environment = "") {
  const data = payload.data || {};
  const parcelId = String(data.parcelId || data.parcelID || payload.subject || "").trim();
  const event = String(data.event || "").trim();
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

async function recordBoxNowWebhookAttempt(attemptRef, data = {}) {
  if (!attemptRef) return;
  try {
    await attemptRef.set({
      ...data,
      updatedAt: now(),
    }, { merge: true });
  } catch (err) {
    logger.error("BOX NOW webhook attempt audit failed", { error: err.message || "Audit write failed" });
  }
}

const boxNowWebhookOptions = {
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
  };

function boxNowWebhookHandler(fixedEnvironment) {
  return async (req, res) => {
    let attemptRef = null;
    let environment = sanitizeBoxNowEnvironment(fixedEnvironment);
    try {
      const settings = await getEffectiveBoxNowSettings(req, { includeSecrets: true });
      attemptRef = db.collection("boxNowWebhookAttempts").doc(environment).collection("attempts").doc();
      await recordBoxNowWebhookAttempt(attemptRef, {
        receivedAt: now(),
        environment,
        method: String(req.method || "").slice(0, 12),
        contentType: String(req.get("content-type") || "").slice(0, 160),
        userAgent: String(req.get("user-agent") || "").slice(0, 500),
        sourceIp: String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim().slice(0, 100),
        outcome: "received",
      });
      if (req.method !== "POST") {
        await recordBoxNowWebhookAttempt(attemptRef, { outcome: "method_not_allowed", httpStatus: 405 });
        return res.status(405).send("Use POST");
      }
      const payload = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const rawBody = req.rawBody || JSON.stringify(payload);
      const config = boxNowEnvConfig(settings, environment);
      const verification = verifyBoxNowWebhookPayload(rawBody, payload, config.webhookSecret);
      if (!verification.verified) {
        logger.warn("BOX NOW webhook rejected", {
          environment,
          reason: verification.reason || "unverified",
        });
        const rejectionStatus = verification.skipped ? 503 : 400;
        await recordBoxNowWebhookAttempt(attemptRef, {
          outcome: "rejected",
          httpStatus: rejectionStatus,
          verificationReason: verification.reason || "unverified",
        });
        return res.status(rejectionStatus).send(
          verification.skipped ? "BOX NOW webhook secret is not configured" : "Invalid BOX NOW webhook signature"
        );
      }

      logger.info("BOX NOW webhook payload received", {
        environment: config.environment,
        payload,
      });

      const update = boxNowTrackingUpdateFromEvent(payload, config.environment);
      const eventId = String(payload.id || `${update.parcelId}_${update.event}_${update.eventTime}`).replace(/[\/#?[\]]+/g, "_");
      if (!update.event) {
        await recordBoxNowWebhookAttempt(attemptRef, {
          outcome: "rejected",
          httpStatus: 400,
          verificationReason: "missing_event",
          eventId,
          orderNumber: update.orderNumber,
          parcelId: update.parcelId,
        });
        return res.status(400).send("Missing BOX NOW data.event");
      }
      await recordBoxNowWebhookAttempt(attemptRef, {
        outcome: "verified",
        httpStatus: 200,
        verificationReason: "verified",
        eventId,
        event: update.event,
        orderNumber: update.orderNumber,
        parcelId: update.parcelId,
        eventTime: update.eventTime,
      });
      await db.collection("boxNowWebhookEvents").doc(eventId || String(Date.now())).set({
        payload,
        verification,
        parsed: update,
        receivedAt: now(),
      }, { merge: true });
      await db.collection("boxNowWebhookHealth").doc(config.environment).set({
        eventId,
        event: update.event,
        orderNumber: update.orderNumber,
        parcelId: update.parcelId,
        eventTime: update.eventTime,
        receivedAt: now(),
      }, { merge: true });

      if (update.orderNumber) {
        const snap = await db.collection("orders").where("orderNumber", "==", update.orderNumber).limit(1).get();
        if (!snap.empty) {
          const orderRef = snap.docs[0].ref;
          const order = snap.docs[0].data() || {};
          const parcelKey = orderStatusDocKey(update.parcelId || "unknown");
          const parcelEvents = {
            ...(order.boxNowShipment?.parcelEvents || {}),
          };
          const previousParcelEvent = parcelEvents[parcelKey] || {};
          const incomingEventMs = millisFromTimestamp(update.eventTime);
          const previousEventMs = millisFromTimestamp(previousParcelEvent.eventTime);
          if (previousEventMs && incomingEventMs && incomingEventMs < previousEventMs) {
            await recordBoxNowWebhookAttempt(attemptRef, { outcome: "stale_ignored", httpStatus: 200 });
            return res.status(200).send("[ok: stale event ignored]");
          }
          const normalizedEvent = normalizeOrderStatus(update.event).replace(/[_\s]+/g, "-");
          const eventRecord = {
            parcelId: update.parcelId,
            event: normalizedEvent,
            parcelState: update.parcelState || "",
            eventTime: update.eventTime || "",
            eventLocation: update.eventLocation || null,
            webhookEventId: eventId,
          };
          parcelEvents[parcelKey] = eventRecord;
          const eventHistory = (Array.isArray(order.boxNowShipment?.eventHistory)
            ? order.boxNowShipment.eventHistory
            : Object.values(order.boxNowShipment?.parcelEvents || {}))
            .filter(item => item && String(item.webhookEventId || "") !== eventId)
            .concat(eventRecord)
            .sort((a, b) => millisFromTimestamp(a.eventTime) - millisFromTimestamp(b.eventTime))
            .slice(-100);
          const expectedParcelIds = (Array.isArray(order.boxNowShipment?.parcelIds) ? order.boxNowShipment.parcelIds : [])
            .map(value => String(value || "").trim())
            .filter(Boolean);
          const deliveredParcelIds = Object.values(parcelEvents)
            .filter(item => normalizeOrderStatus(item.event).replace(/[_\s]+/g, "-") === "delivered")
            .map(item => String(item.parcelId || "").trim())
            .filter(Boolean);
          const allParcelsDelivered = normalizedEvent === "delivered" && (
            expectedParcelIds.length <= 1 ||
            expectedParcelIds.every(parcelId => deliveredParcelIds.includes(parcelId))
          );
          const automaticFulfillment = boxNowFulfillmentForEvent(normalizedEvent, {
            allParcelsDelivered,
            parcelState: update.parcelState,
          });
          const previousFulfillmentStatus = normalizeOrderStatus(order.fulfillmentStatus || "new");
          const fulfillmentRank = { new: 0, processing: 1, packed: 2, shipped: 3, delivered: 4 };
          const shouldAdvanceFulfillment = (
            automaticFulfillment &&
            String(order.status || "").trim().toLowerCase() !== "cancelled" &&
            Number(fulfillmentRank[automaticFulfillment] ?? -1) > Number(fulfillmentRank[previousFulfillmentStatus] ?? -1)
          );
          const deliveredEventDate = update.eventTime ? new Date(update.eventTime) : null;
          const orderUpdate = {
            boxNowShipment: {
              lastEvent: update.event,
              lastParcelState: update.parcelState,
              lastParcelId: update.parcelId,
              lastEventAt: update.eventTime,
              lastWebhookAt: now(),
              environment: config.environment,
              parcelEvents,
              eventHistory,
              deliveredParcelIds,
            },
            shipping: {
              trackingNumber: update.parcelId,
              trackingUrl: boxNowTrackingUrl(update.parcelId),
            },
            boxNowWebhookEventIds: FieldValue.arrayUnion(eventId),
            updatedAt: now(),
          };
          if (shouldAdvanceFulfillment) {
            orderUpdate.fulfillmentStatus = automaticFulfillment;
            orderUpdate.fulfillmentAutomaticallyBy = "boxnow_webhook";
          }
          if (shouldAdvanceFulfillment && automaticFulfillment === "delivered") {
            orderUpdate.status = "completed";
            orderUpdate.deliveredAt = deliveredEventDate && !Number.isNaN(deliveredEventDate.getTime())
              ? Timestamp.fromDate(deliveredEventDate)
              : now();
            orderUpdate.deliveredAutomaticallyBy = "boxnow_webhook";
          }
          if (config.environment === "production") {
            const currentReview = order.boxNowNotificationReview || {};
            if (normalizedEvent === "final-destination" && !(
              String(currentReview.parcelId || "") === update.parcelId &&
              ["pending", "approved", "dismissed"].includes(String(currentReview.status || ""))
            )) {
              const eventMs = millisFromTimestamp(update.eventTime) || Date.now();
              orderUpdate.boxNowNotificationReview = {
                status: "pending",
                parcelId: update.parcelId,
                event: normalizedEvent,
                eventTime: update.eventTime || "",
                webhookEventId: eventId,
                proposedReminderAt: Timestamp.fromMillis(eventMs + 18 * 60 * 60 * 1000),
                createdAt: now(),
              };
            } else if (
              ["delivered", "expired", "returned", "canceled", "missing"].includes(normalizedEvent) &&
              currentReview.status === "pending" &&
              String(currentReview.parcelId || "") === update.parcelId
            ) {
              orderUpdate.boxNowNotificationReview = {
                ...currentReview,
                status: "cancelled",
                cancelReason: normalizedEvent,
                cancelledAt: now(),
              };
            }
          }
          await orderRef.set(orderUpdate, { merge: true });

          if (config.environment === "production" && shouldAdvanceFulfillment) {
            const updatedOrder = {
              ...order,
              ...orderUpdate,
              id: orderRef.id,
              fulfillmentStatus: automaticFulfillment,
              shipping: {
                ...(order.shipping || {}),
                ...(orderUpdate.shipping || {}),
              },
              boxNowShipment: {
                ...(order.boxNowShipment || {}),
                ...(orderUpdate.boxNowShipment || {}),
              },
            };
            try {
              await sendBoxNowFulfillmentEmailOnce(updatedOrder, previousFulfillmentStatus, eventId);
            } catch (emailError) {
              logger.error("Automatic BOX NOW fulfillment email failed", {
                orderId: orderRef.id,
                fulfillmentStatus: automaticFulfillment,
                webhookEventId: eventId,
                error: emailError.message || "Email failed",
              });
            }
          }

          if (config.environment === "production") {
            try {
              if (["delivered", "expired", "returned", "canceled", "missing"].includes(normalizedEvent)) {
                await cancelAutomaticBoxNowLockerReminder(orderRef.id, update.parcelId, normalizedEvent);
              }
            } catch (automationError) {
              logger.error("BOX NOW customer notification automation failed", {
                orderId: orderRef.id,
                parcelId: update.parcelId,
                event: normalizedEvent,
                error: automationError.message || "Notification automation failed",
              });
            }
          }
        }
      }

      return res.status(200).send("[ok]");
    } catch (err) {
      logger.error("BOX NOW webhook failed", err);
      await recordBoxNowWebhookAttempt(attemptRef, {
        environment,
        outcome: "handler_error",
        httpStatus: 500,
        error: String(err.message || "Webhook failed").slice(0, 500),
      });
      return res.status(500).send("BOX NOW webhook failed");
    }
  };
}

// Keep the original registered URL pinned to production so an admin setting can
// never accidentally break live callbacks. New registrations should use the
// explicit environment URLs below.
exports.boxNowWebhook = onRequest(boxNowWebhookOptions, boxNowWebhookHandler("production"));
exports.boxNowWebhookStage = onRequest(boxNowWebhookOptions, boxNowWebhookHandler("stage"));
exports.boxNowWebhookProduction = onRequest(boxNowWebhookOptions, boxNowWebhookHandler("production"));

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
      const pools = Object.fromEntries((await getInventoryPools()).map(pool => [pool.id, pool]));

      for (const [clientId, product] of Object.entries(productsMap)) {
        const poolId = String(product.inventoryPoolId || "").trim();
        const pool = pools[poolId];
        const weightGrams = Math.max(0, Number(product.weightGrams || 0));
        result[clientId] = pool && weightGrams > 0 && pool.updatedAt
          ? Math.max(0, Math.floor(pool.availableGrams / weightGrams))
          : Math.max(0, Number(product.stock || 0));
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
  const requiredValues = {
    name: s.name,
    phone: s.phone,
    addressLine1: s.addressLine1 || s.line1,
    city: s.city,
    postal: s.postal || s.postalCode,
    country: s.country,
  };
  const missing = Object.entries(requiredValues)
    .filter(([, value]) => !String(value || "").trim())
    .map(([key]) => key);
  return missing.length ? `Missing: ${missing.join(", ")}` : null;
}

function normalizeCustomerShipping(input = {}, existing = {}) {
  const source = input && typeof input === "object" ? input : {};
  const previous = existing && typeof existing === "object" ? existing : {};
  const line1 = String(source.addressLine1 || source.line1 || source.address || "").trim();
  const line2 = String(source.addressLine2 || source.line2 || "").trim();
  const postal = String(source.postalCode || source.postal || source.zip || "").trim();
  const sourceBoxNow = source.boxNow && typeof source.boxNow === "object" ? source.boxNow : null;
  const previousBoxNow = previous.boxNow && typeof previous.boxNow === "object" ? previous.boxNow : {};
  return {
    ...previous,
    ...source,
    name: String(source.name || "").trim(),
    phone: String(source.phone || "").trim(),
    line1,
    addressLine1: line1,
    line2,
    addressLine2: line2,
    postal,
    postalCode: postal,
    city: String(source.city || "").trim(),
    region: String(source.region || "").trim(),
    country: String(source.country || "Greece").trim() || "Greece",
    ...(sourceBoxNow ? { boxNow: { ...previousBoxNow, ...sourceBoxNow } } : {}),
  };
}

async function persistCustomerShipping(uid, shippingInput = {}, profile = {}) {
  if (!uid || uid === "guest") return null;
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() || {} : {};
  const shipping = normalizeCustomerShipping(shippingInput, existing.shipping);
  const update = {
    shipping,
    name: shipping.name || existing.name || existing.displayName || "",
    displayName: shipping.name || existing.displayName || existing.name || "",
    phone: shipping.phone || existing.phone || "",
    updatedAt: now(),
  };
  const email = normalizedEmail(profile.email || existing.email || existing.emailLower || "");
  if (email) {
    update.email = email;
    update.emailLower = email;
  }
  if (!existing.createdAt) update.createdAt = now();
  await ref.set(update, { merge: true });
  return shipping;
}

const CUSTOMER_SESSION_COOKIE = "grubz_customer_session";
const CUSTOMER_SESSION_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function requestCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "")
    .split(";")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const separator = part.indexOf("=");
      return separator < 0 ? [part, ""] : [part.slice(0, separator), part.slice(separator + 1)];
    }));
}

function customerSessionCookie(value, maxAgeSeconds) {
  return `${CUSTOMER_SESSION_COOKIE}=${value}; Max-Age=${maxAgeSeconds}; Path=/; Domain=grubz.gr; HttpOnly; Secure; SameSite=Lax`;
}

// Durable customer session fallback for browsers that fail to restore Firebase's
// IndexedDB/localStorage auth state. The cookie never exposes credentials to JS.
exports.customerSession = onRequest(
  { region: "europe-west1", invoker: "public", cors: ALLOWED_ORIGIN_LIST },
  async (req, res) => {
    try {
      res.set("Cache-Control", "private, no-store, max-age=0");
      if (req.method === "OPTIONS") return res.status(204).end();

      if (req.method === "POST") {
        const match = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
        if (!match) return jsonError(res, 401, "Unauthorized");
        const decoded = await getAdminAuth().verifyIdToken(match[1], true);
        const sessionCookie = await getAdminAuth().createSessionCookie(match[1], { expiresIn: CUSTOMER_SESSION_MAX_AGE_MS });
        res.setHeader("Set-Cookie", customerSessionCookie(sessionCookie, Math.floor(CUSTOMER_SESSION_MAX_AGE_MS / 1000)));
        return res.json({ ok: true, uid: decoded.uid, email: decoded.email || "" });
      }

      if (req.method === "GET") {
        const sessionCookie = requestCookies(req)[CUSTOMER_SESSION_COOKIE] || "";
        if (!sessionCookie) return jsonError(res, 401, "No active session");
        const decoded = await getAdminAuth().verifySessionCookie(sessionCookie, true);
        const customToken = await getAdminAuth().createCustomToken(decoded.uid);
        return res.json({ ok: true, customToken });
      }

      if (req.method === "DELETE") {
        res.setHeader("Set-Cookie", customerSessionCookie("", 0));
        return res.json({ ok: true });
      }

      return jsonError(res, 405, "Use GET, POST, or DELETE");
    } catch (e) {
      logger.warn("customerSession failed", e);
      if (req.method === "DELETE") {
        res.setHeader("Set-Cookie", customerSessionCookie("", 0));
        return res.json({ ok: true });
      }
      return jsonError(res, 401, "Session unavailable");
    }
  },
);

// --- GET /getProfile
exports.getProfile = onRequest({ region: "europe-west1", invoker: "public" }, (req, res) =>
  corsMw(req, res, async () => {
    if (req.method === "OPTIONS") return res.status(204).end();
    const uid = await uidFromAuthHeader(req);
    if (!uid) return res.status(401).json({ error: "Unauthorized" });

    res.set("Cache-Control", "private, no-store, max-age=0");
    const snap = await db.doc(`users/${uid}`).get();
    const data = snap.exists ? snap.data() : {};
    return res.json({
      email: data.email || null,
      shipping: data.shipping && typeof data.shipping === "object"
        ? normalizeCustomerShipping(data.shipping)
        : null,
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

    const shippingInput = (req.body && req.body.shipping) || null;
    const err = validateShipping(shippingInput);
    if (err) return res.status(400).json({ error: err });

    const shipping = await persistCustomerShipping(uid, shippingInput);
    return res.json({ ok: true, shipping });
  })
);
