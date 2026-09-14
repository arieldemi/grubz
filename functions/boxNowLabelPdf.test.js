const test = require("node:test");
const assert = require("node:assert/strict");
const { PDFDocument } = require("pdf-lib");
const { composeA4BoxNowLabels } = require("./boxNowLabelPdf");

async function sampleLabel() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([250, 350]);
  page.drawRectangle({ x: 10, y: 10, width: 20, height: 20 });
  return Buffer.from(await pdf.save());
}

test("combines multiple BOX NOW parcel labels into one A4 PDF", async () => {
  const label = await sampleLabel();
  const combined = await composeA4BoxNowLabels([label, label], { labelWidthCm: 9 });
  const output = await PDFDocument.load(combined.buffer);

  assert.equal(combined.layout.labelCount, 2);
  assert.ok(output.getPageCount() >= 1);
});
