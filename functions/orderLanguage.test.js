const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeOrderLanguage, resolveOrderLanguage } = require("./orderLanguage");

test("normalizes Greek order locale variants", () => {
  for (const language of ["el", "EL", "el-GR", "el_GR"]) {
    assert.equal(normalizeOrderLanguage(language), "el");
  }
});

test("resolves the language stored on the original order", () => {
  assert.equal(resolveOrderLanguage({ language: "el" }), "el");
  assert.equal(resolveOrderLanguage({ locale: "el-GR" }), "el");
  assert.equal(resolveOrderLanguage({ metadata: { language: "el" } }), "el");
  assert.equal(resolveOrderLanguage({ language: "en", metadata: { language: "el" } }), "en");
});

test("defaults unknown and missing languages to English", () => {
  assert.equal(resolveOrderLanguage({}), "en");
  assert.equal(resolveOrderLanguage({ language: "fr" }), "en");
});
