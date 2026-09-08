"use strict";

const BOLD_MARKERS = /\*\*([^*\r\n]+?)\*\*/g;

function emailMarkdownToPlainText(value = "") {
  return String(value || "").replace(BOLD_MARKERS, "$1");
}

function emailMarkdownToHtml(value = "") {
  return String(value || "")
    .split(/(<[^>]+>)/g)
    .map(part => part.startsWith("<") ? part : part.replace(BOLD_MARKERS, '<strong style="color:#aa2315;">$1</strong>'))
    .join("");
}

module.exports = { emailMarkdownToPlainText, emailMarkdownToHtml };
