"use strict";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function absoluteStorefrontUrl(value, origin = "https://www.grubz.gr") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, origin).toString();
  } catch {
    return "";
  }
}

function productAvailability(product = {}) {
  if (product.allowBackorder === true) return "available for order";
  if (Number.isFinite(Number(product.stock)) && Number(product.stock) <= 0) return "out of stock";
  return "in stock";
}

function buildProductMeta(productId, product, origin = "https://www.grubz.gr", language = "") {
  const id = String(productId || "").trim();
  const localizedLanguage = language === "el" || language === "en" ? language : "";
  const title = String(localizedLanguage === "el" ? (product.nameEl || product.name || id) : (product.name || id)).trim();
  const socialTitle = id === "happy-chicken-3kg"
    ? "Happy Chicken – Φυσική Πρωτεΐνη για Κότες"
    : title;
  const description = String(localizedLanguage === "el"
    ? (product.descriptionEl || product.detailEl || product.description || product.detail || title)
    : (product.description || product.detail || title)).trim();
  const languagePrefix = localizedLanguage ? `/${localizedLanguage}` : "";
  const url = `${origin.replace(/\/$/, "")}${languagePrefix}/products/${encodeURIComponent(id)}`;
  const englishUrl = `${origin.replace(/\/$/, "")}/en/products/${encodeURIComponent(id)}`;
  const greekUrl = `${origin.replace(/\/$/, "")}/el/products/${encodeURIComponent(id)}`;
  const image = absoluteStorefrontUrl(product.imageEn || product.image || product.imageEl, origin);
  const amount = (Math.max(0, Number(product.amount || 0)) / 100).toFixed(2);
  const currency = String(product.currency || "eur").toUpperCase();
  const availability = productAvailability(product);
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    sku: id,
    name: title,
    description,
    image: image ? [image] : undefined,
    brand: { "@type": "Brand", name: "GRUBZ" },
    offers: {
      "@type": "Offer",
      url,
      price: amount,
      priceCurrency: currency,
      availability: availability === "out of stock"
        ? "https://schema.org/OutOfStock"
        : availability === "available for order"
          ? "https://schema.org/PreOrder"
          : "https://schema.org/InStock",
      itemCondition: "https://schema.org/NewCondition",
    },
  }).replace(/</g, "\\u003c");

  return [
    `<title>${escapeHtml(title)} | GRUBZ</title>`,
    `<meta name="description" content="${escapeHtml(description)}">`,
    '<meta property="og:type" content="product">',
    `<meta property="og:title" content="${escapeHtml(socialTitle)}">`,
    `<meta property="og:description" content="${escapeHtml(description)}">`,
    `<meta property="og:url" content="${escapeHtml(url)}">`,
    image ? `<meta property="og:image" content="${escapeHtml(image)}">` : "",
    `<meta property="product:retailer_item_id" content="${escapeHtml(id)}">`,
    `<meta property="product:price:amount" content="${escapeHtml(amount)}">`,
    `<meta property="product:price:currency" content="${escapeHtml(currency)}">`,
    `<meta property="product:availability" content="${escapeHtml(availability)}">`,
    '<meta property="product:condition" content="new">',
    '<meta property="product:brand" content="GRUBZ">',
    `<link rel="canonical" href="${escapeHtml(url)}">`,
    localizedLanguage ? `<link rel="alternate" hreflang="en" href="${escapeHtml(englishUrl)}">` : "",
    localizedLanguage ? `<link rel="alternate" hreflang="el" href="${escapeHtml(greekUrl)}">` : "",
    localizedLanguage ? `<link rel="alternate" hreflang="x-default" href="${escapeHtml(englishUrl)}">` : "",
    `<script type="application/ld+json">${jsonLd}</script>`,
  ].filter(Boolean).join("\n    ");
}

function injectProductMeta(html, meta) {
  const removable = [
    /\s*<title>[\s\S]*?<\/title>/i,
    /\s*<meta\s+name=["']description["'][^>]*>/i,
    /\s*<meta\s+property=["']og:(?:type|title|description|url|image(?::[^"']+)?)["'][^>]*>/gi,
    /\s*<link\s+(?:id=["'][^"']+["']\s+)?rel=["'](?:canonical|alternate)["'][^>]*>/gi,
  ];
  let output = String(html || "");
  for (const pattern of removable) output = output.replace(pattern, "");
  return output.replace(/<\/head>/i, `    ${meta}\n  </head>`);
}

module.exports = {
  absoluteStorefrontUrl,
  buildProductMeta,
  injectProductMeta,
  productAvailability,
};
