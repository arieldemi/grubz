const test = require("node:test");
const assert = require("node:assert/strict");
const { buildProductMeta, injectProductMeta, productAvailability } = require("./productPage");

test("productAvailability reflects stock and backorders", () => {
  assert.equal(productAvailability({ stock: 2 }), "in stock");
  assert.equal(productAvailability({ stock: 0 }), "out of stock");
  assert.equal(productAvailability({ stock: 0, allowBackorder: true }), "available for order");
});

test("buildProductMeta creates matching Meta and structured product data", () => {
  const meta = buildProductMeta("happy-chicken-1kg", {
    name: "Happy Chicken 1kg",
    description: "Protein & calcium",
    image: "/images/products/happy-chicken-1kg.jpg",
    amount: 1990,
    currency: "eur",
    stock: 4,
  });

  assert.match(meta, /product:retailer_item_id" content="happy-chicken-1kg"/);
  assert.match(meta, /product:price:amount" content="19\.90"/);
  assert.match(meta, /product:price:currency" content="EUR"/);
  assert.match(meta, /https:\/\/www\.grubz\.gr\/images\/products\/happy-chicken-1kg\.jpg/);
  assert.match(meta, /"sku":"happy-chicken-1kg"/);
  assert.match(meta, /Protein &amp; calcium/);
});

test("buildProductMeta uses the campaign title for Happy Chicken 3kg", () => {
  const meta = buildProductMeta("happy-chicken-3kg", {
    name: "Happy Chicken 3KG",
    amount: 1590,
  });

  assert.match(meta, /og:title" content="Happy Chicken – Φυσική Πρωτεΐνη για Κότες"/);
  assert.match(meta, /<title>Happy Chicken 3KG \| GRUBZ<\/title>/);
});

test("buildProductMeta creates localized canonical and hreflang links", () => {
  const meta = buildProductMeta("happy-chicken-10kg", {
    name: "Happy Chicken 10KG",
    nameEl: "Happy Chicken 10KG για κότες",
    description: "Large pack for chickens.",
    descriptionEl: "Μεγάλη συσκευασία για κότες.",
    amount: 4990,
  }, "https://www.grubz.gr", "el");

  assert.match(meta, /<title>Happy Chicken 10KG για κότες \| GRUBZ<\/title>/);
  assert.match(meta, /description" content="Μεγάλη συσκευασία για κότες\./);
  assert.match(meta, /rel="canonical" href="https:\/\/www\.grubz\.gr\/el\/products\/happy-chicken-10kg"/);
  assert.match(meta, /hreflang="en" href="https:\/\/www\.grubz\.gr\/en\/products\/happy-chicken-10kg"/);
  assert.match(meta, /hreflang="el" href="https:\/\/www\.grubz\.gr\/el\/products\/happy-chicken-10kg"/);
});

test("injectProductMeta replaces generic page metadata", () => {
  const shell = '<html><head><title>Generic</title><meta name="description" content="generic"><meta property="og:title" content="Generic"></head><body></body></html>';
  const result = injectProductMeta(shell, '<title>Product | GRUBZ</title><meta property="product:retailer_item_id" content="product-1">');

  assert.doesNotMatch(result, /<title>Generic<\/title>/);
  assert.doesNotMatch(result, /content="generic"/);
  assert.match(result, /<title>Product \| GRUBZ<\/title>/);
  assert.match(result, /product:retailer_item_id/);
});
