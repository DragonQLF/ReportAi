import { spawn } from 'child_process';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import sharp from 'sharp';
import { generateText } from 'ai';
import { logger } from '../utils/logger';
import { PipelineError } from '../utils/errors';
import { uploadOutput } from '../storage/screenshot-storage.service';
import { proModel } from './ai';
import type { WriterOutput, Section, LatexOutput } from './schemas';

interface LatexInput {
  writerOutput: WriterOutput;
  sections: Section[];
  screenshots: {
    index: number;
    url: string;
    feature: string;
    description: string;
  }[];
  imageBuffers: { index: number; buffer: Buffer }[];
  context: {
    reportId: string;
    title: string;
    company: string;
    role: string;
    dates: string;
    language: string;
    style: string;
    font: string;
    customFields?: Record<string, { label: string; value: string }>;
  };
}

/**
 * Generate a LaTeX document from the writer output, then compile to PDF.
 * Uses local pdflatex when available, otherwise returns only the .tex file.
 */
export async function generateLatex(input: LatexInput): Promise<LatexOutput> {
  const { writerOutput, sections, screenshots, imageBuffers, context } = input;

  logger.info('Starting LaTeX generation', {
    reportId: context.reportId,
    sections: sections.length,
  });

  try {
    // Step 1: Build LaTeX document from template
    const texContent = buildLatexDocument({
      title: context.title,
      company: context.company,
      role: context.role,
      dates: context.dates,
      introduction: writerOutput.introduction,
      sections: writerOutput.sections.map((sc) => {
        const clusterSection = sections.find((s) => s.name === sc.sectionName);
        return {
          name: sc.sectionName,
          content: sc.content,
          screenshotIndices: clusterSection?.screenshotIndices ?? [],
        };
      }),
      conclusion: writerOutput.conclusion,
      screenshots,
      language: context.language,
      font: context.font,
      customFields: context.customFields,
    });

    // Step 2 & 3: Compile PDF (upload .tex, compile, retry with AI fix if needed)
    const namedImages = imageBuffers.map((b) => ({
      filename: `screenshot_${b.index}`,
      buffer: b.buffer,
    }));

    const compiled = await compileLatexDocument(texContent, namedImages, context.reportId);

    logger.info('LaTeX generation complete', {
      reportId: context.reportId,
      texUrl: compiled.texUrl,
      pdfUrl: compiled.pdfUrl ?? 'not compiled',
    });

    return {
      texContent,
      texUrl: compiled.texUrl,
      pdfUrl: compiled.pdfUrl,
    };
  } catch (error) {
    logger.error('LaTeX generation failed', { error });
    throw new PipelineError('latex', `Failed to generate LaTeX: ${(error as Error).message}`);
  }
}

/**
 * Compile a pre-built LaTeX document, upload the results to R2, and return the URLs.
 * This is the public entry point for the editor — it takes an already-generated .tex string.
 *
 * Pass a unique `filePrefix` (e.g. `report-${Date.now()}`) when editing an existing report so
 * each version is stored under a distinct R2 key and old versions are not overwritten.
 * The default `'report'` keeps the original behavior for initial pipeline generation.
 */
export async function compileLatexDocument(
  texContent: string,
  images: { filename: string; buffer: Buffer }[],
  reportId: string,
  filePrefix = 'report',
): Promise<{ pdfUrl?: string; texUrl: string }> {
  const texUrl = await uploadOutput(Buffer.from(texContent, 'utf-8'), {
    reportId,
    filename: `${filePrefix}.tex`,
    contentType: 'application/x-tex',
  });

  let pdfUrl: string | undefined;
  let finalTexContent = texContent;
  let finalTexUrl = texUrl;

  const first = await compilePdf(finalTexContent, images, reportId);

  if (first.buffer) {
    pdfUrl = await uploadOutput(first.buffer, {
      reportId,
      filename: `${filePrefix}.pdf`,
      contentType: 'application/pdf',
    });
  } else if (first.error) {
    logger.warn('PDF compilation failed in editor, attempting AI fix', { reportId, error: first.error });
    const fixedTex = await fixLatexWithAI(finalTexContent, first.error);
    finalTexContent = fixedTex;
    finalTexUrl = await uploadOutput(Buffer.from(fixedTex, 'utf-8'), {
      reportId,
      filename: `${filePrefix}.tex`,
      contentType: 'application/x-tex',
    });
    const second = await compilePdf(fixedTex, images, reportId);
    if (second.buffer) {
      pdfUrl = await uploadOutput(second.buffer, {
        reportId,
        filename: `${filePrefix}.pdf`,
        contentType: 'application/pdf',
      });
    }
  }

  return { pdfUrl, texUrl: finalTexUrl };
}

/**
 * Compile a LaTeX document to PDF using local pdflatex.
 * Returns { buffer } on success, { error } on LaTeX failure, or {} if pdflatex is missing.
 */
async function compilePdf(
  texContent: string,
  images: { filename: string; buffer: Buffer }[],
  reportId: string,
): Promise<{ buffer?: Buffer; error?: string }> {
  let tmpDir: string | undefined;
  try {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'reportai-'));

    // Write .tex file
    await writeFile(path.join(tmpDir, 'report.tex'), texContent, 'utf-8');

    // Convert all images to PNG in parallel (normalise to avoid WebP/format issues with pdflatex).
    // Promise.allSettled ensures all promises settle before the finally block cleans up tmpDir —
    // avoids dangling writeFile calls writing to a deleted directory if one conversion fails.
    const conversions = await Promise.allSettled(
      images.map(async ({ filename, buffer }) => {
        const pngBuffer = await sharp(buffer).png().toBuffer();
        await writeFile(path.join(tmpDir, `${filename}.png`), pngBuffer);
      }),
    );
    const failed = conversions.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;

    // Run pdflatex twice: first pass builds structure, second resolves TOC/refs
    await runPdflatex(tmpDir);
    await runPdflatex(tmpDir);

    const buffer = await readFile(path.join(tmpDir, 'report.pdf'));
    logger.info('PDF compiled successfully', { reportId, bytes: buffer.length });
    return { buffer };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      logger.warn('pdflatex not found on PATH — skipping PDF compilation');
      return {};
    }
    return { error: err.message };
  } finally {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}

/**
 * Ask Gemini Pro to fix a LaTeX document that failed to compile.
 */
async function fixLatexWithAI(texContent: string, compilationError: string): Promise<string> {
  const { text } = await generateText({
    model: proModel,
    prompt: `A LaTeX document failed to compile with the following error:

--- ERROR ---
${compilationError}
--- END ERROR ---

--- DOCUMENT ---
${texContent}
--- END DOCUMENT ---

Fix the LaTeX document so it compiles correctly. The most common cause is document-level commands (\\documentclass, \\usepackage, \\begin{document}, \\end{document}) appearing inside the document body — these must be removed or wrapped in a verbatim environment.

Return ONLY the corrected LaTeX source. No explanation, no markdown fences, no extra text.`,
  });

  // Strip markdown code fences if the model added them anyway
  return text.trim().replace(/^```(?:latex)?\n?/, '').replace(/\n?```$/, '');
}

function runPdflatex(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('pdflatex', ['-interaction=nonstopmode', '-halt-on-error', 'report.tex'], {
      cwd,
    });
    let output = '';
    proc.stdout?.on('data', (d: Buffer) => { output += d.toString(); });
    proc.stderr?.on('data', (d: Buffer) => { output += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pdflatex exited with code ${code}\n${output.slice(-500)}`));
    });
  });
}

/**
 * Build a complete LaTeX document string from the report components.
 */
function buildLatexDocument(params: {
  title: string;
  company: string;
  role: string;
  dates: string;
  introduction: string;
  sections: { name: string; content: string; screenshotIndices: number[] }[];
  conclusion: string;
  screenshots: { index: number; url: string; feature: string; description: string }[];
  language: string;
  font: string;
  customFields?: Record<string, { label: string; value: string }>;
}): string {
  const { title, company, role, dates, introduction, sections, conclusion, screenshots, language, font, customFields } = params;

  const fontPackage =
    font === 'times'      ? '\\usepackage{times}\n' :
    font === 'helvetica'  ? '\\usepackage{helvet}\n\\renewcommand{\\familydefault}{\\sfdefault}\n' :
    font === 'calibri'    ? '\\usepackage[sfdefault]{carlito}\n' :  // Carlito — free Calibri clone
    font === 'arial'      ? '\\usepackage{helvet}\n\\renewcommand{\\familydefault}{\\sfdefault}\n' :
    font === 'charter'    ? '\\usepackage{charter}\n' :
    font === 'palatino'   ? '\\usepackage{palatino}\n' :
    '\\usepackage[lining]{ebgaramond}\n'; // default: EB Garamond lining figures — lighter, widely used in European academia

  const LANG_MAP: Record<string, string> = {
    en: 'english',
    pt: 'portuges',
    'pt-br': 'brazilian',
    es: 'spanish',
    fr: 'french',
    de: 'ngerman',
    it: 'italian',
    nl: 'dutch',
    pl: 'polish',
    ru: 'russian',
    el: 'greek',
    cs: 'czech',
    sk: 'slovak',
    hu: 'magyar',
    ro: 'romanian',
    tr: 'turkish',
    sv: 'swedish',
    no: 'norsk',
    da: 'danish',
    fi: 'finnish',
  };
  const langPackage = LANG_MAP[language?.toLowerCase()?.trim()] ?? 'english';

  // Build figure commands for each screenshot
  const figureForIndex = (idx: number): string => {
    const screenshot = screenshots.find((s) => s.index === idx);
    if (!screenshot) return '';

    const caption = screenshot.feature;

    return `
\\begin{figure}[H]
  \\centering
  \\includegraphics[width=0.95\\textwidth]{screenshot_${idx}}
  \\caption{${escapeLatex(caption)}}
  \\label{fig:screenshot_${idx}}
\\end{figure}`;
  };

  // Build section content with embedded figures
  const sectionContent = sections
    .map((section) => {
      const figures = section.screenshotIndices
        .map((idx) => figureForIndex(idx))
        .filter(Boolean)
        .join('\n');

      return `
\\section{${escapeLatex(section.name)}}

${section.content}

${figures}`;
    })
    .join('\n');

  return `\\documentclass[12pt,a4paper]{article}

\\usepackage[${langPackage}]{babel}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
${fontPackage}
\\usepackage{graphicx}
\\usepackage{float}
\\usepackage[hidelinks]{hyperref}
\\usepackage{geometry}
\\usepackage{fancyhdr}
\\usepackage{setspace}
\\usepackage{parskip}
\\usepackage{enumitem}

\\geometry{margin=2.5cm}
\\onehalfspacing

\\pagestyle{fancy}
\\fancyhf{}
\\rhead{${escapeLatex(title)}}
\\lhead{${escapeLatex(company)}}
\\cfoot{\\thepage}

\\begin{document}

${buildCoverPage({ title, company, role, dates, customFields })}

\\tableofcontents
\\newpage

\\listoffigures
\\newpage

\\section{Introduction}

${introduction}

${sectionContent}

\\section{Conclusion}

${conclusion}

\\end{document}
`;
}

/**
 * Build a clean titlepage for the report.
 * Works for both professional/internship and academic/school contexts.
 * Shows subject, supervisor, or other relevant custom fields when present.
 */
function buildCoverPage(params: {
  title: string;
  company: string;
  role: string;
  dates: string;
  customFields?: Record<string, { label: string; value: string }>;
}): string {
  const { title, company, role, dates, customFields } = params;

  const lines: string[] = [
    '\\begin{titlepage}',
    '  \\centering',
    '  \\vspace*{5cm}',
    `  {\\huge\\bfseries ${escapeLatex(title)}\\par}`,
    '  \\vspace{0.8cm}',
    '  \\noindent\\rule{0.5\\textwidth}{0.5pt}\\par',
    '  \\vspace{1.8cm}',
  ];

  if (role) {
    lines.push(`  {\\large ${escapeLatex(role)}\\par}`);
    lines.push('  \\vspace{0.3cm}');
  }
  if (company) {
    lines.push(`  {\\normalsize\\itshape ${escapeLatex(company)}\\par}`);
  }

  // Show all custom fields the chat AI decided to collect — it already filters to only
  // domain-relevant fields, so no hardcoded allowlist needed here.
  if (customFields) {
    const coverEntries = Object.values(customFields).filter((f) => f.value);
    if (coverEntries.length > 0) {
      lines.push('  \\vspace{0.6cm}');
      for (const entry of coverEntries) {
        lines.push(`  {\\small\\textit{${escapeLatex(entry.label)}}: ${escapeLatex(entry.value)}\\par}`);
        lines.push('  \\vspace{0.1cm}');
      }
    }
  }

  if (dates) {
    lines.push('  \\vspace{1.5cm}');
    lines.push(`  {\\normalsize ${escapeLatex(dates)}\\par}`);
  }

  lines.push('  \\vfill');
  lines.push('  \\noindent\\rule{\\textwidth}{0.4pt}');
  lines.push('\\end{titlepage}');

  return lines.join('\n');
}

/** Escape special LaTeX characters in a string. */
function escapeLatex(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}]/g, (match) => `\\${match}`)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}
