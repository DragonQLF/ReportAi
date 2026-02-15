import { generateText, Output } from 'ai';
import { z } from 'zod';
import { flashModel } from './ai';
import { downloadFromR2 } from '../storage/screenshot-storage.service';
import { compileLatexDocument, buildLatexDocument } from './latex';
import { editSectionsPrompt } from './prompts';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { PipelineError } from '../utils/errors';
import { getScreenshotCache } from '../utils/screenshot-cache';

export interface EditInput {
  reportId: string;
  message: string;
  imageUrl?: string;
  chatHistory: { role: string; content: string }[];
  onProgress?: (stage: 'fetching' | 'analyzing_image' | 'editing' | 'compiling') => void;
}

export interface EditOutput {
  tex: string;
  pdfUrl?: string;
  texUrl: string;
  summary: string;
}

interface StoredSectionContent {
  introduction: string;
  sections: { sectionName: string; content: string; screenshotIndices: number[] }[];
  conclusion: string;
}

const editSectionsResultSchema = z.object({
  summary: z.string().describe('One sentence describing what you changed'),
  updatedSections: z.array(z.object({
    sectionName: z.string().describe('Exact section name as shown in brackets: "introduction", "conclusion", or the section title'),
    content: z.string().describe('Full updated prose for this section'),
  })),
});

function applyUpdates(
  current: StoredSectionContent,
  updates: { sectionName: string; content: string }[],
): StoredSectionContent {
  let { introduction, conclusion } = current;
  const sections = current.sections.map((s) => ({ ...s }));

  for (const update of updates) {
    if (update.sectionName === 'introduction') {
      introduction = update.content;
    } else if (update.sectionName === 'conclusion') {
      conclusion = update.content;
    } else {
      const idx = sections.findIndex((s) => s.sectionName === update.sectionName);
      if (idx !== -1) sections[idx] = { ...sections[idx], content: update.content };
    }
  }

  return { introduction, sections, conclusion };
}

/**
 * Edit an already-generated report based on a natural-language instruction.
 * Reads structured section content from DB, edits prose with Flash,
 * rebuilds .tex server-side — no R2 fetch for the document, no Pro model.
 */
export async function editDocument(input: EditInput): Promise<EditOutput> {
  logger.info('Starting document edit', { reportId: input.reportId, message: input.message });

  try {
    // 1. Load report data and structured section content from DB
    input.onProgress?.('fetching');
    const reportData = await prisma.report.findUnique({
      where: { id: input.reportId },
      select: {
        sectionContent: true,
        title: true, company: true, role: true, dates: true,
        language: true, style: true, font: true, customFields: true,
      },
    });

    if (!reportData?.sectionContent) {
      throw new Error('Report does not have structured section content — cannot edit');
    }

    const stored = reportData.sectionContent as StoredSectionContent;

    // 2. Analyze attached image if provided
    let imageDescription: string | undefined;
    let imageFilename: string | undefined;
    let imageBuffer: Buffer | undefined;

    if (input.imageUrl) {
      input.onProgress?.('analyzing_image');
      imageBuffer = await downloadFromR2(input.imageUrl);
      const { text } = await generateText({
        model: flashModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', image: imageBuffer },
              {
                type: 'text',
                text: 'Describe this image in 1-2 sentences. State what type it is (logo, screenshot, photo, diagram, chart, etc.) and its main visual characteristics.',
              },
            ],
          },
        ],
      });
      imageDescription = text.trim();
      imageFilename = 'edit_image';
      logger.info('Image analyzed for edit', { reportId: input.reportId, description: imageDescription });
    }

    // 3. Edit sections with Flash — prose only, no LaTeX
    input.onProgress?.('editing');
    const prompt = editSectionsPrompt({
      title: reportData.title ?? '',
      company: reportData.company ?? '',
      role: reportData.role ?? '',
      language: reportData.language ?? 'en',
      style: reportData.style ?? 'professional',
      instruction: input.message,
      sectionContent: stored,
      chatHistory: input.chatHistory,
      imageDescription,
      imageFilename,
    });

    const result = await generateText({
      model: flashModel,
      output: Output.object({ schema: editSectionsResultSchema }),
      prompt,
    });

    const updated = applyUpdates(stored, result.object.updatedSections);

    // 4. Get screenshot metadata to rebuild .tex (captions + figure indices)
    const screenshots = await prisma.screenshot.findMany({
      where: { reportId: input.reportId, excluded: false },
      orderBy: { index: 'asc' },
      select: { index: true, url: true, feature: true, description: true },
    });

    const newTex = buildLatexDocument({
      title: reportData.title ?? '',
      company: reportData.company ?? '',
      role: reportData.role ?? '',
      dates: reportData.dates ?? '',
      introduction: updated.introduction,
      sections: updated.sections.map((s) => ({
        name: s.sectionName,
        content: s.content,
        screenshotIndices: s.screenshotIndices,
      })),
      conclusion: updated.conclusion,
      screenshots: screenshots.map((s) => ({
        index: s.index,
        url: s.url,
        feature: s.feature ?? '',
        description: s.description ?? '',
      })),
      language: reportData.language ?? 'en',
      font: reportData.font ?? 'default',
      customFields: (reportData.customFields as Record<string, { label: string; value: string }>) ?? undefined,
    });

    // 5. Persist updated structure so next edit starts from the new state
    await prisma.report.update({
      where: { id: input.reportId },
      data: { sectionContent: updated },
    });

    logger.info('Structured edit complete', { reportId: input.reportId, summary: result.object.summary });
    input.onProgress?.('compiling');
    return compileAndStore(newTex, result.object.summary, input, imageBuffer, imageFilename);
  } catch (error) {
    logger.error('Document edit failed', { reportId: input.reportId, error });
    throw new PipelineError('editor', `Failed to edit document: ${(error as Error).message}`);
  }
}

async function compileAndStore(
  modifiedTex: string,
  summary: string,
  input: EditInput,
  imageBuffer?: Buffer,
  imageFilename?: string,
): Promise<EditOutput> {
  // Get screenshot PNGs for compilation — cache-first, R2 fallback
  const screenshots = await prisma.screenshot.findMany({
    where: { reportId: input.reportId, excluded: false },
    orderBy: { index: 'asc' },
    select: { index: true, url: true },
  });

  const filenames = screenshots.map((s) => `screenshot_${s.index}`);
  const screenshotBuffers =
    (await getScreenshotCache(input.reportId, filenames)) ??
    (await Promise.all(
      screenshots.map(async (s) => ({
        filename: `screenshot_${s.index}`,
        buffer: await downloadFromR2(s.url),
      })),
    ));

  const allImages = [...screenshotBuffers];
  if (imageBuffer && imageFilename) {
    allImages.push({ filename: imageFilename, buffer: imageBuffer });
  }

  const filePrefix = `report-${Date.now()}`;
  const compiled = await compileLatexDocument(modifiedTex, allImages, input.reportId, filePrefix);

  logger.info('Document edit complete', {
    reportId: input.reportId,
    texUrl: compiled.texUrl,
    pdfUrl: compiled.pdfUrl ?? 'not compiled',
    summary,
  });

  return {
    tex: modifiedTex,
    pdfUrl: compiled.pdfUrl,
    texUrl: compiled.texUrl,
    summary,
  };
}
