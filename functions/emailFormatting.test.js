"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { emailMarkdownToPlainText, emailMarkdownToHtml } = require("./emailFormatting");

test("converts paired bold markers in email HTML", () => {
  assert.equal(
    emailMarkdownToHtml("Save **10% today** with code **WELCOME10**."),
    'Save <strong style="color:#aa2315;">10% today</strong> with code <strong style="color:#aa2315;">WELCOME10</strong>.'
  );
});

test("keeps existing HTML intact and only formats text nodes", () => {
  assert.equal(
    emailMarkdownToHtml('<a href="https://grubz.gr/**offer**">**Shop now**</a>'),
    '<a href="https://grubz.gr/**offer**"><strong style="color:#aa2315;">Shop now</strong></a>'
  );
});

test("removes paired bold markers from plain-text email content", () => {
  assert.equal(emailMarkdownToPlainText("Use **WELCOME10**"), "Use WELCOME10");
});

test("leaves unmatched and multiline markers unchanged", () => {
  assert.equal(emailMarkdownToHtml("An **unfinished marker"), "An **unfinished marker");
  assert.equal(emailMarkdownToHtml("**first\nsecond**"), "**first\nsecond**");
});
