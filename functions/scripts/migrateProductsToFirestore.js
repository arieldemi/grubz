#!/usr/bin/env node

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");

const products = [
  {
    id: "happy-chicken-1kg",
    active: true,
    sortOrder: 10,
    name: "Happy Chicken - 1kg",
    nameEl: "Happy Chicken - 1kg",
    description: "Dried BSF larvae for chickens.",
    descriptionEl: "Αποξηραμένες προνύμφες BSF για κότες.",
    detail: "A 1kg chicken treat pack made with dried BSF larvae. A simple protein-rich supplement for flock enrichment and natural pecking behavior.",
    detailEl: "Συσκευασία 1kg με αποξηραμένες προνύμφες BSF για κότες. Πλούσιο πρωτεϊνούχο συμπλήρωμα.",
    amount: 590,
    currency: "eur",
    weightGrams: 1000,
    stock: 100,
    image: "images/happy-chicken-1kg.png",
    imageBg: "#f8f1eb",
    stripeProductId: "prod_UqXuwHrzsk73em",
    stripePriceId: "price_1TqqolCIlWvuSYE0BC5cgRo0",
  },
  {
    id: "happy-chicken-2kg",
    active: true,
    sortOrder: 20,
    name: "Happy Chicken - 2kg",
    nameEl: "Happy Chicken - 2kg",
    description: "Value pack of dried BSF larvae for chickens.",
    descriptionEl: "Οικονομική συσκευασία αποξηραμένων BSF για κότες.",
    detail: "A 2kg value pack for regular chicken feeding. Built for better value per kilo while keeping the same dried BSF larvae quality.",
    detailEl: "Συσκευασία 2kg για τακτική χρήση, με καλύτερη αξία ανά κιλό και την ίδια ποιότητα.",
    amount: 1190,
    currency: "eur",
    weightGrams: 2000,
    stock: 100,
    image: "images/happy-chicken-2kg.png",
    imageBg: "#f8f1eb",
    stripeProductId: "prod_UqXuUWqKQIrcmR",
    stripePriceId: "price_1TqqonCIlWvuSYE0jtDBgH4z",
  },
  {
    id: "happy-chicken-3kg",
    active: true,
    sortOrder: 30,
    name: "Happy Chicken - 3kg",
    nameEl: "Happy Chicken - 3kg",
    description: "Large pack of dried BSF larvae for chickens.",
    descriptionEl: "Μεγάλη συσκευασία αποξηραμένων BSF για κότες.",
    detail: "A 3kg large pack for bigger flocks or frequent feeding. Convenient for stocking up on dried BSF larvae treats.",
    detailEl: "Μεγάλη συσκευασία 3kg για μεγαλύτερα κοπάδια ή συχνή χρήση.",
    amount: 1590,
    currency: "eur",
    weightGrams: 3000,
    stock: 100,
    image: "images/happy-chicken-3kg.png",
    imageBg: "#f8f1eb",
    stripeProductId: "prod_UqXuZ1Qqas8NgB",
    stripePriceId: "price_1TqqooCIlWvuSYE0nnRgPzQo",
  },
  {
    id: "grubz-100g",
    active: true,
    sortOrder: 40,
    name: "GRUBZ SNACK (100g)",
    nameEl: "GRUBZ SNACK (100g)",
    description: "Crispy dried larvae for reptiles, birds & fish.",
    descriptionEl: "Τραγανές αποξηραμένες προνύμφες για ερπετά, πουλιά και ψάρια.",
    detail: "A compact pack of dried black soldier fly larvae for everyday feeding. High in protein and naturally rich in calcium, suitable for reptiles, birds and fish as part of a balanced diet.",
    detailEl: "Μικρή συσκευασία αποξηραμένων προνυμφών BSF για καθημερινή διατροφή. Πλούσια σε πρωτεΐνη και φυσικό ασβέστιο.",
    amount: 690,
    currency: "eur",
    weightGrams: 100,
    stock: 0,
    image: "images/grubz-product-100g.png",
    imageBg: "#6f4b2e",
    stripeProductId: "prod_T04mib5buNalmY",
    stripePriceId: "price_1SOKizCIlWvuSYE0f718KzIH",
  },
  {
    id: "grubz-300g",
    active: true,
    sortOrder: 50,
    name: "GRUBZ PREMIUM (300g)",
    nameEl: "GRUBZ PREMIUM (300g)",
    description: "Larger larvae, extra crunch, top pick for adults.",
    descriptionEl: "Μεγαλύτερες προνύμφες, έξτρα τραγανές, ιδανικές για ενήλικα ζώα.",
    detail: "A larger premium pack with extra crunch and strong feeding response. Ideal when you feed regularly and want more value without moving to the jumbo size.",
    detailEl: "Μεγαλύτερη premium συσκευασία με έντονη τραγανότητα. Ιδανική για τακτική χρήση και καλύτερη αξία.",
    amount: 1790,
    currency: "eur",
    weightGrams: 300,
    stock: 0,
    image: "images/grubz-product-300g.png",
    imageBg: "#28330c",
    stripeProductId: "prod_T04nyqco6u5tng",
    stripePriceId: "price_1SOKjZCIlWvuSYE0JCTrqTIg",
  },
  {
    id: "grubz-500g",
    active: true,
    sortOrder: 60,
    name: "GRUBZ JUMBO (500g)",
    nameEl: "GRUBZ JUMBO (500g)",
    description: "Dried BSF with herbs for picky eaters.",
    descriptionEl: "Αποξηραμένες BSF με βότανα για απαιτητικούς φίλους.",
    detail: "A jumbo 500g pack for keepers who feed often or manage multiple animals. Dried BSF larvae keep well when sealed and stored in a cool, dry place.",
    detailEl: "Jumbo συσκευασία 500g για συχνή χρήση ή πολλά ζώα. Διατηρείται καλά σφραγισμένη σε δροσερό και ξηρό μέρος.",
    amount: 3690,
    currency: "eur",
    weightGrams: 500,
    stock: 0,
    image: "images/grubz-product-500g.png",
    imageBg: "#94632e",
    stripeProductId: "prod_T04orna0NLSofu",
    stripePriceId: "price_1SOKlECIlWvuSYE0VgEtLPoj",
  },
];

initializeApp({
  credential: applicationDefault(),
  projectId: "grubz-99b84",
});

(async () => {
  const db = getFirestore(undefined, "grubz");
  const now = Timestamp.now();
  const batch = db.batch();

  for (const product of products) {
    const ref = db.collection("products").doc(product.id);
    const existing = await ref.get();
    batch.set(
      ref,
      {
        ...product,
        createdAt: existing.exists ? existing.data().createdAt || now : now,
        updatedAt: now,
        migratedAt: now,
      },
      { merge: true }
    );
  }

  await batch.commit();
  console.log(`Migrated ${products.length} products to Firestore grubz/products.`);
})().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
