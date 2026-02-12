import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const pdfDoc = await PDFDocument.create();
const page = pdfDoc.addPage([595.28, 841.89]); // A4
const { width, height } = page.getSize();

const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);
const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

const gray1 = rgb(0.88, 0.88, 0.90); // light placeholder blocks
const gray2 = rgb(0.78, 0.78, 0.82); // slightly darker
const gray3 = rgb(0.55, 0.55, 0.60); // subtitles
const dark  = rgb(0.18, 0.18, 0.22); // headings

// ── Header bar ──────────────────────────────────────────
page.drawRectangle({ x: 0, y: height - 52, width, height: 52, color: rgb(0.96, 0.96, 0.97) });
page.drawLine({ start: { x: 0, y: height - 52 }, end: { x: width, y: height - 52 }, thickness: 1, color: rgb(0.85, 0.85, 0.88) });

// Logo placeholder
page.drawRectangle({ x: 40, y: height - 42, width: 44, height: 30, color: gray1, borderColor: gray2, borderWidth: 1 });

// University name placeholder
page.drawRectangle({ x: 92, y: height - 34, width: 120, height: 8, color: gray1 });
page.drawRectangle({ x: 92, y: height - 46, width: 80, height: 6, color: rgb(0.92, 0.92, 0.94) });

// ── Title block ─────────────────────────────────────────
const titleY = height - 120;

page.drawText('Internship Report', {
  x: 40, y: titleY,
  size: 22, font: bold, color: dark,
});

page.drawText('2024 — 2025', {
  x: 40, y: titleY - 24,
  size: 11, font: regular, color: gray3,
});

// Thin rule
page.drawLine({ start: { x: 40, y: titleY - 36 }, end: { x: width - 40, y: titleY - 36 }, thickness: 0.5, color: gray1 });

// Author / company meta
const metaY = titleY - 56;
page.drawRectangle({ x: 40, y: metaY - 6, width: 90, height: 7, color: gray1 });
page.drawRectangle({ x: 40, y: metaY - 20, width: 130, height: 6, color: rgb(0.92, 0.92, 0.94) });
page.drawRectangle({ x: 40, y: metaY - 32, width: 70, height: 6, color: rgb(0.92, 0.92, 0.94) });

// ── Abstract ────────────────────────────────────────────
const absY = metaY - 60;
page.drawText('Abstract', { x: 40, y: absY, size: 11, font: bold, color: dark });

const lineW = [width - 80, width - 95, width - 88, width - 100, width - 80];
lineW.forEach((w, i) => {
  page.drawRectangle({ x: 40, y: absY - 18 - i * 12, width: w, height: 6, color: gray1 });
});

// ── Section 1 ────────────────────────────────────────────
const s1Y = absY - 100;
page.drawText('1. Introduction', { x: 40, y: s1Y, size: 12, font: bold, color: dark });
page.drawLine({ start: { x: 40, y: s1Y - 6 }, end: { x: width - 40, y: s1Y - 6 }, thickness: 0.4, color: gray1 });

const s1Lines = [width-80, width-92, width-85, width-88, width-95, width-80, width-100, width-90];
s1Lines.forEach((w, i) => {
  page.drawRectangle({ x: 40, y: s1Y - 20 - i * 12, width: w, height: 6, color: i % 7 === 6 ? rgb(0.92,0.92,0.94) : gray1 });
});

// ── Section 2 ────────────────────────────────────────────
const s2Y = s1Y - 130;
page.drawText('2. Project Overview', { x: 40, y: s2Y, size: 12, font: bold, color: dark });
page.drawLine({ start: { x: 40, y: s2Y - 6 }, end: { x: width - 40, y: s2Y - 6 }, thickness: 0.4, color: gray1 });

const s2Lines = [width-80, width-88, width-95, width-82, width-90, width-96, width-84];
s2Lines.forEach((w, i) => {
  page.drawRectangle({ x: 40, y: s2Y - 20 - i * 12, width: w, height: 6, color: i % 6 === 5 ? rgb(0.92,0.92,0.94) : gray1 });
});

// ── Section 3 ────────────────────────────────────────────
const s3Y = s2Y - 118;
page.drawText('3. Technical Implementation', { x: 40, y: s3Y, size: 12, font: bold, color: dark });
page.drawLine({ start: { x: 40, y: s3Y - 6 }, end: { x: width - 40, y: s3Y - 6 }, thickness: 0.4, color: gray1 });

const s3Lines = [width-80, width-90, width-86, width-100, width-80];
s3Lines.forEach((w, i) => {
  page.drawRectangle({ x: 40, y: s3Y - 20 - i * 12, width: w, height: 6, color: gray1 });
});

// ── "Your PDF will appear here" watermark ───────────────
const watermark = 'Your PDF will appear here';
const ww = regular.widthOfTextAtSize(watermark, 10);
page.drawText(watermark, {
  x: (width - ww) / 2,
  y: 60,
  size: 10, font: regular, color: rgb(0.75, 0.75, 0.78),
});

// ── Page number ─────────────────────────────────────────
page.drawText('1', { x: width / 2 - 3, y: 30, size: 9, font: regular, color: gray3 });

// ── Save ────────────────────────────────────────────────
const bytes = await pdfDoc.save();
const outDir = join(__dirname, '..', 'public');
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'placeholder-report.pdf'), bytes);
console.log('✓ public/placeholder-report.pdf generated');
