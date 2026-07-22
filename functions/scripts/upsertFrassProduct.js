#!/usr/bin/env node

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const product = {
  id: "frass",
  active: false,
  sortOrder: 70,
  name: "Frass",
  nameEl: "Frass",
  description: "BSF frass soil amendment.",
  descriptionEl: "Εδαφοβελτιωτικό frass από BSF.",
  detail: "A natural soil amendment made from black soldier fly frass. Use it as a gentle nutrient boost for plants and soil life.",
  detailEl: "Φυσικό εδαφοβελτιωτικό από frass μαύρης στρατιωτικής μύγας. Για ήπια ενίσχυση των φυτών και του εδάφους.",
  amount: 0,
  currency: "eur",
  weightGrams: 1000,
  parcel: {
    heightCm: 8,
    widthCm: 24,
    lengthCm: 35,
  },
  stock: 0,
  image: "images/livinsoil.png",
  imageBg: "#f1f7ea",
  stripeProductId: "",
  stripePriceId: "",
  stripe: {
    test: {
      productId: "",
      priceId: "",
    },
    live: {
      productId: "",
      priceId: "",
    },
  },
};

initializeApp({
  credential: applicationDefault(),
  projectId: "grubz-99b84",
});

(async () => {
  const db = getFirestore(undefined, "grubz");
  const now = Timestamp.now();
  const ref = db.collection("products").doc(product.id);
  const existing = await ref.get();
  await ref.set(
    {
      ...product,
      createdAt: existing.exists ? existing.data().createdAt || now : now,
      updatedAt: now,
      migratedAt: now,
    },
    { merge: true }
  );
  console.log("Upserted products/frass.");
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
