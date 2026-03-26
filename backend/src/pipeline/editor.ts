import { generateText, Output } from 'ai';
import { z } from 'zod';
import sharp from 'sharp';
import { flashModel } from './ai';
import { downloadFromR2, deleteStorageFile } from '../storage/screenshot-storage.service';
import { compileLatexDocument, buildLatexDocument } from './latex';
import type { LayoutConfig } from './latex';
import { editSectionsPrompt, screenshotAnalysisPrompt } from './prompts';
import { screenshotAnalysisItemSchema } from './schemas';
import { computeImageMetrics, computeHashSimilarity } from './reviewer';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { PipelineError } from '../utils/errors';
import { getScreenshotCache, cacheScreenshotPng } from '../utils/screenshot-cache';

export interface EditInput {
  reportId: string;
  message: string;
  imageUrl?: string;
  chatHistory: { role: string; content: string }[];
  onProgress?: (stage: 'fetching' | 'analyzing_image' | 'editing' | 'compiling') => void;
  skipCompile?: boolean;
}

export interface EditOutput {
  tex: string;
  pdfUrl?: string;
  texUrl: string;
  summary: string;
}

export interface AddScreenshotInput {
  reportId: string;
  imageUrl: string;
  note?: string; // optional user hint about which section this belongs to
  chatHistory: { role: string; content: string }[];
  onProgress?: (stage: 'fetching' | 'analyzing_image' | 'editing' | 'compiling') => void;
  skipCompile?: boolean;
}

export interface RemoveScreenshotInput {
  reportId: string;
  identifier: string; // natural-language description of which screenshot to remove
  chatHistory: { role: string; content: string }[];
  onProgress?: (stage: 'fetching' | 'analyzing_image' | 'editing' | 'compiling') => void;
  skipCompile?: boolean;
}

interface StoredSectionContent {
  introduction: string;
  introductionTitle?: string;
  sections: { sectionName: string; content: string; screenshotIndices: number[]; screenshotPairs?: [number, number][] }[];
  conclusion: string;
  conclusionTitle?: string;
}

const editSectionsResultSchema = z.object({
  summary: z.string().describe('One sentence describing what you changed'),
  updatedSections: z.array(z.object({
    sectionName: z.string().describe('Exact section name as shown in brackets: "introduction", "conclusion", or the section title'),
    content: z.string().describe('Full updated prose for this section'),
    screenshotPairs: z.array(z.array(z.number())).optional().describe('Pairs of screenshot indices to render side-by-side. Only include when the user explicitly requests side-by-side layout.'),
  })),
  coverFields: z.record(z.string(), z.object({
    label: z.string().describe('Human-readable label shown on the cover (e.g. "Student", "Student Number", "Supervisor")'),
    value: z.string().describe('The field value'),
  })).optional().describe('New or updated cover page fields. Only include when the user asks to add/change cover metadata like student name, student number, supervisor, etc. Use short camelCase keys (e.g. "studentName", "studentNumber"). Omit entirely if not requested.'),
  coverConfig: z.object({
    titleSize: z.enum(['huge', 'LARGE', 'Large', 'large', 'normalsize']).optional(),
    companySize: z.enum(['Large', 'large', 'normalsize', 'small', 'footnotesize']).optional(),
    roleSize: z.enum(['Large', 'large', 'normalsize', 'small', 'footnotesize']).optional(),
    datesSize: z.enum(['Large', 'large', 'normalsize', 'small', 'footnotesize']).optional(),
    customFieldSize: z.enum(['Large', 'large', 'normalsize', 'small', 'footnotesize']).optional(),
  }).optional().describe('Cover page font size overrides. Only include when the user asks to make cover text larger or smaller. Omit entirely if not requested.'),
  layoutConfig: z.object({
    header: z.object({ left: z.string(), center: z.string(), right: z.string() }).optional(),
    footer: z.object({ left: z.string(), center: z.string(), right: z.string() }).optional(),
    logoPosition: z.enum([
      'header-left', 'header-right',
      'cover',
      'cover-top-left', 'cover-top-center', 'cover-top-right',
      'cover-bottom-left', 'cover-bottom-center', 'cover-bottom-right',
      'none',
    ]).optional(),
  }).optional().describe('Header/footer text and logo position updates. Only include when the user explicitly requests layout changes.'),
});

const sectionAssignmentSchema = z.object({
  sectionName: z.string().describe('Exact section name from the list, or "new: <Section Name>" to create a new section'),
});

const screenshotIdentificationSchema = z.object({
  screenshotIndex: z.number().int().describe('Index of the screenshot to remove, or -1 if none match the description'),
});

const BLUR_THRESHOLD = 0.95;
const DEDUP_THRESHOLD = 0.95;

function applyUpdates(
  current: StoredSectionContent,
  updates: { sectionName: string; content: string; screenshotPairs?: [number, number][] }[],
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
      if (idx !== -1) {
        sections[idx] = {
          ...sections[idx],
          content: update.content,
          ...(update.screenshotPairs !== undefined ? { screenshotPairs: update.screenshotPairs } : {}),
        };
      } else {
        // New section — starts with no screenshots; addScreenshotToReport will populate indices
        sections.push({ sectionName: update.sectionName, content: update.content, screenshotIndices: [], screenshotPairs: update.screenshotPairs ?? [] });
      }
    }
  }

  return { ...current, introduction, sections, conclusion };
}

/**
 * Edit an already-generated report based on a natural-language instruction.
 * Reads structured section content from DB, edits prose with Flash,
 * rebuilds .tex server-side — no R2 fetch for the document, no Pro model.
 * If imageUrl is provided, the image is analyzed and its description is passed
 * as context for the prose edit (the image is NOT added to the report — use
 * addScreenshotToReport for that).
 */
export async function editDocument(input: EditInput): Promise<EditOutput> {
  logger.info('Starting document edit', { reportId: input.reportId, message: input.message });

  try {
    // 1. Load report data and structured section content from DB
    input.onProgress?.('fetching');
    const [reportData, editScreenshots] = await Promise.all([
      prisma.report.findUnique({
        where: { id: input.reportId },
        select: {
          sectionContent: true,
          title: true, company: true, role: true, dates: true,
          language: true, style: true, font: true, customFields: true,
          layoutConfig: true,
        },
      }),
      prisma.screenshot.findMany({
        where: { reportId: input.reportId, excluded: false },
        orderBy: { index: 'asc' },
        select: { index: true, feature: true },
      }),
    ]);

    if (!reportData?.sectionContent) {
      throw new Error('Report does not have structured section content — cannot edit');
    }

    const stored = reportData.sectionContent as unknown as StoredSectionContent;

    // 2. Analyze attached image if provided — description used as prose context only
    let imageDescription: string | undefined;

    if (input.imageUrl) {
      input.onProgress?.('analyzing_image');
      const imageBuffer = await downloadFromR2(input.imageUrl);
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
      logger.info('Image analyzed for edit context', { reportId: input.reportId, description: imageDescription });
    }

    // 3. Edit sections with Flash — prose only, no LaTeX
    input.onProgress?.('editing');
    const layoutConfig = reportData.layoutConfig as LayoutConfig | undefined;

    const prompt = editSectionsPrompt({
      title: reportData.title ?? '',
      company: reportData.company ?? '',
      role: reportData.role ?? '',
      language: reportData.language ?? 'en',
      style: reportData.style ?? 'professional',
      instruction: input.message,
      sectionContent: stored,
      screenshots: editScreenshots.map((s) => ({ index: s.index, feature: s.feature ?? '' })),
      chatHistory: input.chatHistory,
      imageDescription,
      imageFilename: imageDescription ? 'attached_image' : undefined,
      layoutConfig,
    });

    const result = await generateText({
      model: flashModel,
      output: Output.object({ schema: editSectionsResultSchema }),
      prompt,
    });

    const editOutput = (result as any).output;
    const updated = applyUpdates(stored, editOutput.updatedSections);

    // 4. Apply AI-returned layoutConfig and coverFields changes if present
    const aiLayoutConfig = editOutput.layoutConfig as Omit<LayoutConfig, 'logoUrl'> | undefined;
    let mergedLayoutConfig: LayoutConfig | undefined = layoutConfig;
    if (aiLayoutConfig) {
      mergedLayoutConfig = { ...layoutConfig, ...aiLayoutConfig };
    }

    const aiCoverFields = editOutput.coverFields as Record<string, { label: string; value: string }> | undefined;
    const existingCustomFields = (reportData.customFields as Record<string, { label: string; value: string }>) ?? {};
    const mergedCustomFields = aiCoverFields
      ? { ...existingCustomFields, ...aiCoverFields }
      : existingCustomFields;

    const aiCoverConfig = editOutput.coverConfig as LayoutConfig['coverConfig'] | undefined;
    if (aiCoverConfig) {
      mergedLayoutConfig = { ...mergedLayoutConfig, coverConfig: { ...(mergedLayoutConfig?.coverConfig ?? {}), ...aiCoverConfig } };
    }

    // 5. Get screenshot metadata to rebuild .tex (captions + figure indices)
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
      introductionTitle: updated.introductionTitle,
      sections: updated.sections.map((s) => ({
        name: s.sectionName,
        content: s.content,
        screenshotIndices: s.screenshotIndices,
        screenshotPairs: s.screenshotPairs,
      })),
      conclusion: updated.conclusion,
      conclusionTitle: updated.conclusionTitle,
      screenshots: screenshots.map((s) => ({
        index: s.index,
        url: s.url,
        feature: s.feature ?? '',
        description: s.description ?? '',
      })),
      language: reportData.language ?? 'en',
      font: reportData.font ?? 'default',
      customFields: Object.keys(mergedCustomFields).length > 0 ? mergedCustomFields : undefined,
      layoutConfig: mergedLayoutConfig,
    });

    // 6. Persist updated structure so next edit starts from the new state
    await prisma.report.update({
      where: { id: input.reportId },
      data: {
        sectionContent: updated as any,
        ...((aiLayoutConfig || aiCoverConfig) ? { layoutConfig: mergedLayoutConfig as any } : {}),
        ...(aiCoverFields ? { customFields: mergedCustomFields as any } : {}),
      },
    });

    // 5b. If an image was attached for context only (not to be added as a figure),
    // mark its Screenshot record excluded so it doesn't inflate screenshotCount or
    // interfere with future dedup checks. Only applies when the upload route already
    // created a record for this URL and addScreenshotToReport hasn't claimed it yet
    // (i.e. feature is still null — vision pass hasn't run on it).
    if (input.imageUrl) {
      await prisma.screenshot.updateMany({
        where: { reportId: input.reportId, url: input.imageUrl, feature: null },
        data: { excluded: true },
      });
    }

    logger.info('Structured edit complete', { reportId: input.reportId, summary: editOutput.summary });
    if (input.skipCompile) {
      return { tex: newTex, summary: editOutput.summary, pdfUrl: undefined, texUrl: '' };
    }
    input.onProgress?.('compiling');
    return compileAndStore(newTex, editOutput.summary, input.reportId);
  } catch (error) {
    logger.error('Document edit failed', { reportId: input.reportId, error });
    throw new PipelineError('editor', `Failed to edit document: ${(error as Error).message}`);
  }
}

/**
 * Add a new screenshot to an already-generated report.
 * Runs the full review pipeline (blur check, dedup against existing screenshots, vision analysis),
 * assigns the image to the appropriate section, saves a new Screenshot record, updates the prose,
 * and recompiles the document.
 */
export async function addScreenshotToReport(input: AddScreenshotInput): Promise<EditOutput> {
  const { reportId, imageUrl } = input;
  logger.info('Adding screenshot to report', { reportId, imageUrl });

  try {
    // 1. Load report data
    input.onProgress?.('fetching');
    const reportData = await prisma.report.findUnique({
      where: { id: reportId },
      select: {
        sectionContent: true,
        title: true, company: true, role: true, dates: true,
        description: true, techStack: true, language: true, style: true, font: true, customFields: true,
        layoutConfig: true,
      },
    });

    if (!reportData?.sectionContent) {
      throw new PipelineError('editor', 'Report does not have structured section content — cannot add screenshot');
    }

    const stored = reportData.sectionContent as unknown as StoredSectionContent;

    // 2. Download new image and run quality checks
    input.onProgress?.('analyzing_image');
    const imageBuffer = await downloadFromR2(imageUrl);
    const { blurScore, hash } = await computeImageMetrics(imageBuffer);

    if (blurScore > BLUR_THRESHOLD) {
      throw new PipelineError('editor', `Screenshot appears blurry or unreadable (score: ${blurScore.toFixed(2)}). Please upload a clearer image.`);
    }

    // 3. Dedup check against existing screenshots
    // Note: the upload route may have already created a Screenshot record for imageUrl
    // (e.g. via uploadEditImage in the frontend). Exclude that record from the dedup check
    // so the image isn't rejected as a duplicate of itself.
    const existingScreenshots = await prisma.screenshot.findMany({
      where: { reportId, excluded: false },
      orderBy: { index: 'asc' },
      select: { id: true, index: true, url: true, feature: true },
    });

    const dedupeScreenshots = existingScreenshots.filter((s) => s.url !== imageUrl);

    if (dedupeScreenshots.length > 0) {
      const filenames = dedupeScreenshots.map((s) => `screenshot_${s.index}`);
      const existingBuffers =
        (await getScreenshotCache(reportId, filenames)) ??
        (await Promise.all(
          dedupeScreenshots.map(async (s) => ({
            filename: `screenshot_${s.index}`,
            buffer: await downloadFromR2(s.url),
          })),
        ));

      for (const { buffer } of existingBuffers) {
        const { hash: existingHash } = await computeImageMetrics(buffer);
        if (computeHashSimilarity(hash, existingHash) >= DEDUP_THRESHOLD) {
          throw new PipelineError('editor', 'This screenshot is already in your report. Please upload a different image.');
        }
      }
    }

    // 4. Vision analysis — full structured output, same as the initial pipeline
    const visionPrompt = screenshotAnalysisPrompt({
      projectName: reportData.title ?? '',
      description: reportData.description ?? '',
      techStack: reportData.techStack ?? [],
      language: reportData.language ?? 'en',
      customFields: (reportData.customFields as Record<string, { label: string; value: string }>) ?? undefined,
    });

    const resized = await sharp(imageBuffer)
      .resize({ width: 1280, withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const visionResult = await generateText({
      model: flashModel,
      output: Output.object({ schema: screenshotAnalysisItemSchema }),
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: visionPrompt },
          { type: 'image', image: resized },
        ],
      }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const vision = (visionResult as any).output as z.infer<typeof screenshotAnalysisItemSchema>;
    if (!vision) {
      throw new PipelineError('editor', 'Vision analysis returned no output for the uploaded screenshot.');
    }

    // Guard: if vision classifies this as a non-screenshot, clean up the pre-uploaded
    // Screenshot record (excluded: false, feature: null) and reject with a helpful redirect.
    if (vision.imageType !== 'screenshot') {
      await prisma.screenshot.updateMany({
        where: { reportId, url: imageUrl, feature: null },
        data: { excluded: true },
      });
      const typeLabel = vision.imageType === 'logo' ? 'a logo or emblem'
        : vision.imageType === 'photo' ? 'a photograph'
        : vision.imageType === 'diagram' ? 'a diagram'
        : 'not a UI screenshot';
      const hint = vision.imageType === 'logo'
        ? ' To place it on the cover or header, say "add this as the cover logo".'
        : ' Only UI screenshots can be added as figures in the report.';
      throw new PipelineError('editor', `This image appears to be ${typeLabel}, not a UI screenshot.${hint}`);
    }

    // 5. Section assignment — which existing section fits, or create a new one?
    input.onProgress?.('editing');
    const bodySections = stored.sections.map((s) => s.sectionName);

    const assignmentResult = await generateText({
      model: flashModel,
      output: Output.object({ schema: sectionAssignmentSchema }),
      prompt: `Assign a screenshot to the correct section of a report.

Sections: ${bodySections.length > 0 ? bodySections.join(', ') : '(none yet)'}

Screenshot:
Feature: ${vision.feature}
Description: ${vision.description}
${input.note ? `\nUser hint: "${input.note}" — treat this as a strong signal for section placement.` : ''}
Reply with the exact section name from the list, or "new: <Section Name>" if it doesn't fit any existing section.`,
    });

    const rawSection = (assignmentResult as any).output.sectionName.trim();
    const isNewSection = rawSection.toLowerCase().startsWith('new:');
    const assignedSection = isNewSection ? rawSection.slice(rawSection.indexOf(':') + 1).trim() : rawSection;

    // 6. Save Screenshot record — reuse the pre-uploaded record if the upload route already
    // created one for this URL (e.g. via uploadEditImage), otherwise create a new one.
    const preUploaded = existingScreenshots.find((s) => s.url === imageUrl);
    let nextIndex: number;

    if (preUploaded) {
      // Record already exists — update it with vision data and clear excluded flag
      nextIndex = preUploaded.index;
      await prisma.screenshot.update({
        where: { id: preUploaded.id },
        data: { feature: vision.feature, description: vision.description, section: assignedSection, blurScore, excluded: false },
      });
    } else {
      // No pre-existing record — compute index and create fresh
      const maxRow = await prisma.screenshot.aggregate({
        where: { reportId },
        _max: { index: true },
      });
      nextIndex = (maxRow._max.index ?? -1) + 1;
      await prisma.screenshot.create({
        data: {
          reportId,
          url: imageUrl,
          index: nextIndex,
          feature: vision.feature,
          description: vision.description,
          section: assignedSection,
          excluded: false,
          blurScore,
        },
      });
    }

    // 7. Cache the new screenshot as PNG so the next compile hits the cache
    const pngBuffer = await sharp(imageBuffer).png().toBuffer();
    cacheScreenshotPng(reportId, `screenshot_${nextIndex}`, pngBuffer).catch(() => {});

    // 8. Update stored sectionContent: add newIndex to the right section's screenshotIndices
    let updatedStored: StoredSectionContent;
    if (isNewSection) {
      updatedStored = {
        ...stored,
        sections: [
          ...stored.sections,
          { sectionName: assignedSection, content: '', screenshotIndices: [nextIndex] },
        ],
      };
    } else {
      const idx = stored.sections.findIndex((s) => s.sectionName === assignedSection);
      if (idx !== -1) {
        const sections = stored.sections.map((s, i) =>
          i === idx ? { ...s, screenshotIndices: [...s.screenshotIndices, nextIndex] } : s,
        );
        updatedStored = { ...stored, sections };
      } else {
        // Assignment returned a name not in the list (model drift) — fall back to new section
        updatedStored = {
          ...stored,
          sections: [
            ...stored.sections,
            { sectionName: assignedSection, content: '', screenshotIndices: [nextIndex] },
          ],
        };
      }
    }

    // 9. Prose edit — update the assigned section to naturally reference the new figure
    const editInstruction = `A new screenshot has been added to the "${assignedSection}" section (Figure: ${vision.feature} — ${vision.description}). Update the "${assignedSection}" section prose to naturally introduce and reference this figure. ${isNewSection ? 'This is a new section — write its full content.' : 'Keep existing content; integrate the new figure naturally.'}`;

    const editPrompt = editSectionsPrompt({
      title: reportData.title ?? '',
      company: reportData.company ?? '',
      role: reportData.role ?? '',
      language: reportData.language ?? 'en',
      style: reportData.style ?? 'professional',
      instruction: editInstruction,
      sectionContent: updatedStored,
      screenshots: [...existingScreenshots.map((s) => ({ index: s.index, feature: s.feature ?? '' })), { index: nextIndex, feature: vision.feature }],
      chatHistory: input.chatHistory,
    });

    const editResult = await generateText({
      model: flashModel,
      output: Output.object({ schema: editSectionsResultSchema }),
      prompt: editPrompt,
    });

    const finalUpdated = applyUpdates(updatedStored, (editResult as any).output.updatedSections);

    // Guarantee screenshotIndices survived applyUpdates (which only touches prose)
    const targetIdx = finalUpdated.sections.findIndex((s) => s.sectionName === assignedSection);
    if (targetIdx !== -1 && !finalUpdated.sections[targetIdx].screenshotIndices.includes(nextIndex)) {
      finalUpdated.sections[targetIdx].screenshotIndices = [
        ...finalUpdated.sections[targetIdx].screenshotIndices,
        nextIndex,
      ];
    }

    // 10. Persist final sectionContent
    await prisma.report.update({
      where: { id: reportId },
      data: { sectionContent: finalUpdated as any },
    });

    // 11. Rebuild .tex with all screenshots (including the new one)
    const allScreenshots = await prisma.screenshot.findMany({
      where: { reportId, excluded: false },
      orderBy: { index: 'asc' },
      select: { index: true, url: true, feature: true, description: true },
    });

    const newTex = buildLatexDocument({
      title: reportData.title ?? '',
      company: reportData.company ?? '',
      role: reportData.role ?? '',
      dates: reportData.dates ?? '',
      introduction: finalUpdated.introduction,
      introductionTitle: finalUpdated.introductionTitle,
      sections: finalUpdated.sections.map((s) => ({
        name: s.sectionName,
        content: s.content,
        screenshotIndices: s.screenshotIndices,
        screenshotPairs: s.screenshotPairs,
      })),
      conclusion: finalUpdated.conclusion,
      conclusionTitle: finalUpdated.conclusionTitle,
      screenshots: allScreenshots.map((s) => ({
        index: s.index,
        url: s.url,
        feature: s.feature ?? '',
        description: s.description ?? '',
      })),
      language: reportData.language ?? 'en',
      font: reportData.font ?? 'default',
      customFields: (reportData.customFields as Record<string, { label: string; value: string }>) ?? undefined,
      layoutConfig: reportData.layoutConfig as LayoutConfig | undefined,
    });

    const summary = `Added screenshot "${vision.feature}" to the "${assignedSection}" section.`;
    logger.info('Screenshot added to report', { reportId, feature: vision.feature, section: assignedSection, index: nextIndex });

    if (input.skipCompile) {
      return { tex: newTex, summary, pdfUrl: undefined, texUrl: '' };
    }
    input.onProgress?.('compiling');
    return compileAndStore(newTex, summary, reportId);
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    logger.error('Screenshot addition failed', { reportId, error });
    throw new PipelineError('editor', `Failed to add screenshot: ${(error as Error).message}`);
  }
}

/**
 * Remove a screenshot from an already-generated report.
 * Identifies the screenshot by natural-language description, sets it excluded,
 * removes its index from sectionContent, cleans up prose references, and recompiles.
 */
export async function removeScreenshotFromReport(input: RemoveScreenshotInput): Promise<EditOutput> {
  const { reportId, identifier } = input;
  logger.info('Removing screenshot from report', { reportId, identifier });

  try {
    // 1. Load report data + all active screenshots
    input.onProgress?.('fetching');
    const [reportData, allScreenshots] = await Promise.all([
      prisma.report.findUnique({
        where: { id: reportId },
        select: {
          sectionContent: true,
          title: true, company: true, role: true, dates: true,
          language: true, style: true, font: true, customFields: true,
          layoutConfig: true,
        },
      }),
      prisma.screenshot.findMany({
        where: { reportId, excluded: false },
        orderBy: { index: 'asc' },
        select: { id: true, index: true, feature: true, description: true },
      }),
    ]);

    if (!reportData?.sectionContent) {
      throw new PipelineError('editor', 'Report does not have structured section content — cannot remove screenshot');
    }
    if (allScreenshots.length === 0) {
      throw new PipelineError('editor', 'This report has no screenshots to remove.');
    }

    // 2. Identify which screenshot the user means
    input.onProgress?.('editing');
    const screenshotList = allScreenshots
      .map((s) => `[index ${s.index}] "${s.feature}" — ${s.description}`)
      .join('\n');

    const identResult = await generateText({
      model: flashModel,
      output: Output.object({ schema: screenshotIdentificationSchema }),
      prompt: `Identify which screenshot the user wants to remove.

User request: "${identifier}"

Available screenshots:
${screenshotList}

Reply with the index of the matching screenshot, or -1 if none match.`,
    });

    const targetIndex = (identResult as any).output.screenshotIndex;
    if (targetIndex === -1) {
      throw new PipelineError('editor', `No screenshot matching "${identifier}" was found in the report.`);
    }

    const targetScreenshot = allScreenshots.find((s) => s.index === targetIndex);
    if (!targetScreenshot) {
      throw new PipelineError('editor', `Screenshot with index ${targetIndex} not found.`);
    }

    // 3. Remove the index from the section's screenshotIndices (in-memory only — DB write deferred)
    // Also drop any screenshotPair that contains the removed index (no splitting — remove whole pair)
    const stored = reportData.sectionContent as unknown as StoredSectionContent;
    const affectedSection = stored.sections.find((s) => s.screenshotIndices.includes(targetIndex));
    const updatedSections = stored.sections.map((s) => ({
      ...s,
      screenshotIndices: s.screenshotIndices.filter((i) => i !== targetIndex),
      screenshotPairs: (s.screenshotPairs ?? []).filter(([a, b]) => a !== targetIndex && b !== targetIndex),
    }));
    const updatedStored: StoredSectionContent = { ...stored, sections: updatedSections };

    // 4. Clean up prose references to the removed screenshot
    const sectionName = affectedSection?.sectionName ?? 'the relevant section';
    const cleanPrompt = editSectionsPrompt({
      title: reportData.title ?? '',
      company: reportData.company ?? '',
      role: reportData.role ?? '',
      language: reportData.language ?? 'en',
      style: reportData.style ?? 'professional',
      instruction: `Screenshot "${targetScreenshot.feature}" has been removed from the "${sectionName}" section. Remove any prose references to it and ensure the section reads naturally without it. If there are no references, return no changes.`,
      sectionContent: updatedStored,
      screenshots: allScreenshots.filter((s) => s.index !== targetIndex).map((s) => ({ index: s.index, feature: s.feature ?? '' })),
      chatHistory: input.chatHistory,
    });

    const cleanResult = await generateText({
      model: flashModel,
      output: Output.object({ schema: editSectionsResultSchema }),
      prompt: cleanPrompt,
    });

    const finalUpdated = applyUpdates(updatedStored, (cleanResult as any).output.updatedSections);

    // 5. Commit both writes together now that the AI step succeeded.
    // Deferring the excluded flag until here means a transient AI failure leaves the
    // screenshot still visible in the report rather than excluded-but-unreferenced.
    await Promise.all([
      prisma.screenshot.update({
        where: { id: targetScreenshot.id },
        data: { excluded: true },
      }),
      prisma.report.update({
        where: { id: reportId },
        data: { sectionContent: finalUpdated as any },
      }),
    ]);

    // 7. Rebuild .tex without the removed screenshot
    const remainingScreenshots = await prisma.screenshot.findMany({
      where: { reportId, excluded: false },
      orderBy: { index: 'asc' },
      select: { index: true, url: true, feature: true, description: true },
    });

    const newTex = buildLatexDocument({
      title: reportData.title ?? '',
      company: reportData.company ?? '',
      role: reportData.role ?? '',
      dates: reportData.dates ?? '',
      introduction: finalUpdated.introduction,
      introductionTitle: finalUpdated.introductionTitle,
      sections: finalUpdated.sections.map((s) => ({
        name: s.sectionName,
        content: s.content,
        screenshotIndices: s.screenshotIndices,
        screenshotPairs: s.screenshotPairs,
      })),
      conclusion: finalUpdated.conclusion,
      conclusionTitle: finalUpdated.conclusionTitle,
      screenshots: remainingScreenshots.map((s) => ({
        index: s.index,
        url: s.url,
        feature: s.feature ?? '',
        description: s.description ?? '',
      })),
      language: reportData.language ?? 'en',
      font: reportData.font ?? 'default',
      customFields: (reportData.customFields as Record<string, { label: string; value: string }>) ?? undefined,
      layoutConfig: reportData.layoutConfig as LayoutConfig | undefined,
    });

    const summary = `Removed screenshot "${targetScreenshot.feature}" from the "${sectionName}" section.`;
    logger.info('Screenshot removed from report', { reportId, feature: targetScreenshot.feature, index: targetIndex });

    if (input.skipCompile) {
      return { tex: newTex, summary, pdfUrl: undefined, texUrl: '' };
    }
    input.onProgress?.('compiling');
    return compileAndStore(newTex, summary, reportId);
  } catch (error) {
    if (error instanceof PipelineError) throw error;
    logger.error('Screenshot removal failed', { reportId, error });
    throw new PipelineError('editor', `Failed to remove screenshot: ${(error as Error).message}`);
  }
}

/**
 * Rebuild the .tex from current DB state and compile once.
 * Called by chat.routes.ts after all tool calls finish, so multi-edit
 * requests only pay one compile instead of one per tool.
 */
export async function compileCurrentReport(reportId: string, summary: string): Promise<EditOutput> {
  const reportData = await prisma.report.findUnique({
    where: { id: reportId },
    select: {
      sectionContent: true,
      title: true, company: true, role: true, dates: true,
      language: true, font: true, customFields: true,
      layoutConfig: true,
    },
  });

  if (!reportData?.sectionContent) {
    throw new PipelineError('editor', 'Report has no section content to compile');
  }

  const stored = reportData.sectionContent as unknown as StoredSectionContent;
  const screenshots = await prisma.screenshot.findMany({
    where: { reportId, excluded: false },
    orderBy: { index: 'asc' },
    select: { index: true, url: true, feature: true, description: true },
  });

  const tex = buildLatexDocument({
    title: reportData.title ?? '',
    company: reportData.company ?? '',
    role: reportData.role ?? '',
    dates: reportData.dates ?? '',
    introduction: stored.introduction,
    introductionTitle: stored.introductionTitle,
    sections: stored.sections.map((s) => ({
      name: s.sectionName,
      content: s.content,
      screenshotIndices: s.screenshotIndices,
      screenshotPairs: s.screenshotPairs,
    })),
    conclusion: stored.conclusion,
    conclusionTitle: stored.conclusionTitle,
    screenshots: screenshots.map((s) => ({
      index: s.index,
      url: s.url,
      feature: s.feature ?? '',
      description: s.description ?? '',
    })),
    language: reportData.language ?? 'en',
    font: reportData.font ?? 'default',
    customFields: (reportData.customFields as Record<string, { label: string; value: string }>) ?? undefined,
    layoutConfig: reportData.layoutConfig as LayoutConfig | undefined,
  });

  return compileAndStore(tex, summary, reportId);
}

export interface SetLogoInput {
  reportId: string;
  imageUrl: string;
  position: 'cover' | 'header-left' | 'header-right';
  onProgress?: (stage: 'fetching' | 'analyzing_image' | 'editing' | 'compiling') => void;
  skipCompile?: boolean;
}

/**
 * Set an uploaded image as the report logo (cover or header).
 * Marks the Screenshot record as excluded, updates layoutConfig,
 * and optionally recompiles.
 */
export async function setLogoFromImage(input: SetLogoInput): Promise<EditOutput> {
  const { reportId, imageUrl, position } = input;
  logger.info('Setting logo from image', { reportId, imageUrl, position });

  try {
    input.onProgress?.('fetching');
    const reportData = await prisma.report.findUnique({
      where: { id: reportId },
      select: { layoutConfig: true },
    });

    const existing = reportData?.layoutConfig as LayoutConfig | undefined;

    // Delete old logo if it's a different image
    if (existing?.logoUrl && existing.logoUrl !== imageUrl) {
      deleteStorageFile(existing.logoUrl).catch(() => {});
    }

    const mergedLayoutConfig: LayoutConfig = {
      ...existing,
      logoUrl: imageUrl,
      logoPosition: position,
    };

    // Mark the screenshot record as excluded — it's a logo, not a figure
    await prisma.screenshot.updateMany({
      where: { reportId, url: imageUrl },
      data: { excluded: true },
    });

    await prisma.report.update({
      where: { id: reportId },
      data: { layoutConfig: mergedLayoutConfig as any },
    });

    const positionLabel = position === 'cover' ? 'cover page' : position === 'header-left' ? 'header (left)' : 'header (right)';
    const summary = `Logo set on ${positionLabel}`;
    logger.info('Logo set', { reportId, position, summary });

    if (input.skipCompile) {
      return { tex: '', summary, pdfUrl: undefined, texUrl: '' };
    }
    input.onProgress?.('compiling');
    return compileCurrentReport(reportId, summary);
  } catch (error) {
    logger.error('Logo set failed', { reportId, error });
    throw new PipelineError('editor', `Failed to set logo: ${(error as Error).message}`);
  }
}

async function compileAndStore(
  modifiedTex: string,
  summary: string,
  reportId: string,
): Promise<EditOutput> {
  // Get screenshot PNGs for compilation — cache-first, R2 fallback
  const [screenshots, reportMeta] = await Promise.all([
    prisma.screenshot.findMany({
      where: { reportId, excluded: false },
      orderBy: { index: 'asc' },
      select: { index: true, url: true },
    }),
    prisma.report.findUnique({
      where: { id: reportId },
      select: { layoutConfig: true },
    }),
  ]);

  // Download logo if configured
  const layoutConfig = reportMeta?.layoutConfig as LayoutConfig | undefined;
  let logoBuffer: Buffer | undefined;
  if (layoutConfig?.logoUrl && layoutConfig?.logoPosition && layoutConfig.logoPosition !== 'none') {
    logoBuffer = await downloadFromR2(layoutConfig.logoUrl).catch(() => undefined);
  }

  const filenames = screenshots.map((s) => `screenshot_${s.index}`);
  const screenshotBuffers =
    (await getScreenshotCache(reportId, filenames)) ??
    (await Promise.all(
      screenshots.map(async (s) => ({
        filename: `screenshot_${s.index}`,
        buffer: await downloadFromR2(s.url),
      })),
    ));

  const filePrefix = `report-${Date.now()}`;
  const compiled = await compileLatexDocument(modifiedTex, screenshotBuffers, reportId, filePrefix, logoBuffer);

  logger.info('Document compile complete', {
    reportId,
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
