function normalizeOrderLanguage(value = "") {
  const language = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  return language === "el" || language.startsWith("el-") ? "el" : "en";
}

function resolveOrderLanguage(order = {}) {
  return normalizeOrderLanguage(
    order.language ||
    order.locale ||
    order.metadata?.language ||
    order.metadata?.locale ||
    "en"
  );
}

module.exports = {
  normalizeOrderLanguage,
  resolveOrderLanguage,
};
