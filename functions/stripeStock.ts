import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import Stripe from "stripe";

/**
 * SECRETS
 */
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");

/**
 * Map your client product IDs -> Stripe productId / priceId
 * Fill in real Stripe IDs (prod_..., price_...)
 */
const MAP: Record<string, { productId: string; priceId: string }> = {
  "grubz-100g": { productId: "prod_xxx_100", priceId: "price_xxx_100" },
  "grubz-300g": { productId: "prod_xxx_300", priceId: "price_xxx_300" },
  "grubz-500g": { productId: "prod_xxx_500", priceId: "price_xxx_500" },
};

function stripeClient(secret: string) {
  return new Stripe(secret, { apiVersion: "2024-09-30.acacia" });
}

/**
 * GET /stock
 * Public endpoint. Returns { [clientId]: number }
 * Reads stock from Stripe Product metadata.stock (integer).
 */
export const getStock = onRequest(
  { cors: true, secrets: [STRIPE_SECRET_KEY] },
  async (req, res) => {
    try {
      const secret = STRIPE_SECRET_KEY.value();
      const stripe = stripeClient(secret);

      const productIds = Object.values(MAP).map((m) => m.productId);
      // Fetch products in batches if you have many; for 3 it’s fine to loop
      const result: Record<string, number> = {};
      for (const [clientId, { productId }] of Object.entries(MAP)) {
        const p = await stripe.products.retrieve(productId);
        const raw = (p.metadata?.stock ?? "0").toString();
        const qty = Math.max(0, parseInt(raw, 10) || 0);
        result[clientId] = qty;
      }
      res.status(200).json(result);
    } catch (e: any) {
      logger.error("getStock failed", e);
      res.status(500).json({ error: "stock_unavailable" });
    }
  }
);

/**
 * POST /createCheckoutSession
 * Body: { items: [{ id: 'grubz-100g', qty: number }] }
 * Validates stock and creates a Stripe Checkout Session.
 */
export const createCheckoutSession = onRequest(
  { cors: true, secrets: [STRIPE_SECRET_KEY] },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).end();

    try {
      const secret = STRIPE_SECRET_KEY.value();
      const stripe = stripeClient(secret);
      const body = req.body || {};
      const items: Array<{ id: string; qty: number }> = Array.isArray(body.items) ? body.items : [];

      // Validate input
      if (!items.length) return res.status(400).json({ error: "no_items" });

      // Build line items and validate stock
      const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
      const insufficient: Array<{ id: string; requested: number; available: number }> = [];

      // Load current stock from Stripe
      const stockCache: Record<string, number> = {};
      for (const [clientId, ref] of Object.entries(MAP)) {
        const p = await stripe.products.retrieve(ref.productId);
        stockCache[clientId] = Math.max(0, parseInt((p.metadata?.stock ?? "0").toString(), 10) || 0);
      }

      for (const { id, qty } of items) {
        const ref = MAP[id];
        if (!ref) return res.status(400).json({ error: `unknown_item:${id}` });

        const available = stockCache[id] ?? 0;
        if (qty > available) {
          insufficient.push({ id, requested: qty, available });
        } else if (qty > 0) {
          line_items.push({ price: ref.priceId, quantity: qty });
        }
      }

      if (insufficient.length) {
        return res.status(409).json({ error: "insufficient_stock", details: insufficient });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items,
        // success_url and cancel_url must be your hosted URLs:
        success_url: "https://yourdomain.example/success",
        cancel_url: "https://yourdomain.example/cancel",
        allow_promotion_codes: true,
        // Optional: client_reference_id, customer_email, shipping_address_collection, etc.
      });

      res.status(200).json({ url: session.url });
    } catch (e: any) {
      logger.error("createCheckoutSession failed", e);
      res.status(500).json({ error: "checkout_failed" });
    }
  }
);

/**
 * POST /stripeWebhook
 * Decrement product metadata.stock after successful payment.
 * Set your endpoint in Stripe Dashboard with the same secret.
 */
export const stripeWebhook = onRequest(
  {
    cors: true,
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
    // We must receive the raw body for signature verification:
    consumeAppEngineForwardedHeaders: false,
    // CF v2 onRequest provides rawBody at req.rawBody
  },
  async (req, res) => {
    const secret = STRIPE_SECRET_KEY.value();
    const webhookSecret = STRIPE_WEBHOOK_SECRET.value();
    const stripe = stripeClient(secret);
    const sig = req.headers["stripe-signature"] as string;

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } catch (err: any) {
      logger.warn("Webhook signature verification failed", err);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as Stripe.Checkout.Session;

        // Get purchased line items
        const lineItems = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 });

        // Build a clientId -> qty map from line items, using priceId mapping
        const deltas: Record<string, number> = {};
        for (const li of lineItems.data) {
          const priceId = (li.price as Stripe.Price)?.id;
          if (!priceId) continue;
          const entry = Object.entries(MAP).find(([, v]) => v.priceId === priceId);
          if (!entry) continue;
          const [clientId] = entry;
          const qty = li.quantity || 0;
          deltas[clientId] = (deltas[clientId] || 0) + qty;
        }

        // Decrement stock on the related Stripe Products (in metadata.stock)
        for (const [clientId, dec] of Object.entries(deltas)) {
          const ref = MAP[clientId];
          if (!ref) continue;
          const prod = await stripe.products.retrieve(ref.productId);
          const current = Math.max(0, parseInt((prod.metadata?.stock ?? "0").toString(), 10) || 0);
          const next = Math.max(0, current - dec);
          await stripe.products.update(ref.productId, { metadata: { ...prod.metadata, stock: String(next) } });
          logger.info(`Stock updated for ${clientId}: ${current} -> ${next}`);
        }
      }

      res.json({ received: true });
    } catch (e: any) {
      logger.error("Webhook handler failed", e);
      res.status(500).end();
    }
  }
);
