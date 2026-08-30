const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const GRUBZ_LOGO_URL = "https://grubz.gr/images/grubz-icon-80.png";
const BRAND_RED = rgb(0.55, 0.08, 0.035);
const POINTS_PER_CM = 72 / 2.54;
const A4 = { width: 21 * POINTS_PER_CM, height: 29.7 * POINTS_PER_CM };

let cachedLogoBytes = null;

async function getGrubzLogoBytes(fetchImpl = fetch) {
  if (cachedLogoBytes) return cachedLogoBytes;
  const response = await fetchImpl(GRUBZ_LOGO_URL, { headers: { accept: "image/png" } });
  if (!response.ok) throw new Error(`GRUBZ logo could not be loaded (${response.status})`);
  cachedLogoBytes = Buffer.from(await response.arrayBuffer());
  return cachedLogoBytes;
}

async function brandBoxNowLabelPdf(sourceBytes, options = {}) {
  const sourcePdf = await PDFDocument.load(sourceBytes);
  if (!sourcePdf.getPageCount()) throw new Error("BOX NOW returned an empty label PDF");

  const outputPdf = await PDFDocument.create();
  const pages = await outputPdf.copyPages(sourcePdf, sourcePdf.getPageIndices());
  const logoBytes = options.logoBytes || await getGrubzLogoBytes(options.fetchImpl);
  const logo = await outputPdf.embedPng(logoBytes);
  const font = await outputPdf.embedFont(StandardFonts.HelveticaBold);

  for (const page of pages) {
    const { width, height } = page.getSize();
    const headerHeight = Math.max(72, Math.min(132, width * 0.2));
    page.setHeight(height + headerHeight);
    page.drawRectangle({ x: 0, y: height, width, height: headerHeight, color: rgb(1, 1, 1) });

    const iconSize = headerHeight * 0.62;
    const fontSize = Math.min(headerHeight * 0.43, width * 0.105);
    const wordmark = "GRUBZ.gr";
    const textWidth = font.widthOfTextAtSize(wordmark, fontSize);
    const gap = headerHeight * 0.12;
    const groupWidth = iconSize + gap + textWidth;
    const startX = Math.max(18, (width - groupWidth) / 2);
    const iconY = height + (headerHeight - iconSize) / 2;
    const textY = height + (headerHeight - fontSize) / 2 + fontSize * 0.08;

    page.drawImage(logo, { x: startX, y: iconY, width: iconSize, height: iconSize });
    page.drawText(wordmark, { x: startX + iconSize + gap, y: textY, size: fontSize, font, color: BRAND_RED });
    outputPdf.addPage(page);
  }

  return Buffer.from(await outputPdf.save());
}

function chooseA4Grid(aspectRatio, options = {}) {
  const margin = Number(options.marginCm || 0.3) * POINTS_PER_CM;
  const gap = Number(options.gapCm || 0.2) * POINTS_PER_CM;
  const labelWidth = Number(options.labelWidthCm || 9) * POINTS_PER_CM;
  const labelHeight = labelWidth * aspectRatio;
  let best = null;

  for (const page of [
    { width: A4.width, height: A4.height, orientation: "portrait" },
    { width: A4.height, height: A4.width, orientation: "landscape" },
  ]) {
    const availableWidth = page.width - margin * 2;
    const availableHeight = page.height - margin * 2;
    const columns = Math.floor((availableWidth + gap + 0.01) / (labelWidth + gap));
    const rows = Math.floor((availableHeight + gap + 0.01) / (labelHeight + gap));
    if (!columns || !rows) continue;
    const candidate = {
      ...page,
      columns,
      rows,
      capacity: columns * rows,
      labelWidth,
      labelHeight,
      margin,
      gap,
    };
    if (!best || candidate.capacity > best.capacity ||
      (candidate.capacity === best.capacity && candidate.orientation === "portrait")) best = candidate;
  }

  if (!best) throw new Error("A 9 cm BOX NOW label cannot fit on A4 with its current proportions");
  return best;
}

async function composeA4BoxNowLabels(labelPdfs, options = {}) {
  if (!Array.isArray(labelPdfs) || !labelPdfs.length) throw new Error("Select at least one BOX NOW label");
  const outputPdf = await PDFDocument.create();
  const embeddedLabels = [];

  for (const bytes of labelPdfs) {
    const source = await PDFDocument.load(bytes);
    const embeddedPages = await outputPdf.embedPdf(bytes, source.getPageIndices());
    for (const page of embeddedPages) {
      embeddedLabels.push({ page, width: page.width, height: page.height, aspectRatio: page.height / page.width });
    }
  }

  const tallestRatio = Math.max(...embeddedLabels.map(label => label.aspectRatio));
  const grid = chooseA4Grid(tallestRatio, options);
  const originX = grid.margin;
  const originY = grid.margin;

  embeddedLabels.forEach((label, index) => {
    if (index % grid.capacity === 0) outputPdf.addPage([grid.width, grid.height]);
    const page = outputPdf.getPage(outputPdf.getPageCount() - 1);
    const slot = index % grid.capacity;
    const column = slot % grid.columns;
    const row = Math.floor(slot / grid.columns);
    const scale = grid.labelWidth / label.width;
    const width = label.width * scale;
    const height = label.height * scale;
    const cellX = originX + column * (grid.labelWidth + grid.gap);
    const cellTop = grid.height - originY - row * (grid.labelHeight + grid.gap);
    page.drawPage(label.page, {
      x: cellX + (grid.labelWidth - width) / 2,
      y: cellTop - grid.labelHeight + (grid.labelHeight - height) / 2,
      width,
      height,
    });
  });

  return {
    buffer: Buffer.from(await outputPdf.save()),
    layout: {
      pageSize: "A4",
      orientation: grid.orientation,
      columns: grid.columns,
      rows: grid.rows,
      labelsPerPage: grid.capacity,
      labelWidthCm: Number((grid.labelWidth / POINTS_PER_CM).toFixed(2)),
      pageCount: outputPdf.getPageCount(),
      labelCount: embeddedLabels.length,
    },
  };
}

async function prepareA4BoxNowLabelPdf(sourceBytes, options = {}) {
  const branded = await brandBoxNowLabelPdf(sourceBytes, options);
  return composeA4BoxNowLabels([branded], { labelWidthCm: 9 });
}

module.exports = {
  brandBoxNowLabelPdf,
  composeA4BoxNowLabels,
  prepareA4BoxNowLabelPdf,
  chooseA4Grid,
  getGrubzLogoBytes,
};
