import { generateText } from 'ai';
import { flashModel, proModel } from './ai';
import { downloadFromR2 } from '../storage/screenshot-storage.service';
import { compileLatexDocument } from './latex';
import { editDocumentPrompt } from './prompts';
import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { PipelineError } from '../utils/errors';

export interface EditInput {
  reportId: string;
  texUrl: string;
  message: string;
  imageUrl?: string;
  chatHistory: { role: string; content: string }[];
  reportContext: {
    title?: string | null;
    company?: string | null;
    role?: string | null;
    language: string;
    style: string;
  };
}

export interface EditOutput {
  tex: string;
  pdfUrl?: string;
  texUrl: string;
  summary: string;
}

/**
 * Edit an already-generated LaTeX document based on a natural-language instruction.
 * Fetches the .tex from R2, calls Gemini Pro to apply the edit, recompiles, re-uploads.
 */
export async function editDocument(input: EditInput): Promise<EditOutput> {
  logger.info('Starting document edit', { reportId: input.reportId, message: input.message });

  try {
    // 1. Fetch current .tex source
    const texBuffer = await downloadFromR2(input.texUrl);
    const texContent = texBuffer.toString('utf-8');

    // 2. If an image was attached, describe it with Flash
    let imageDescription: string | undefined;
    let imageFilename: string | undefined;
    let imageBuffer: Buffer | undefined;

    if (input.imageUrl) {
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

    // 3. Build prompt and call Gemini Pro
    const prompt = editDocumentPrompt({
      texContent,
      instruction: input.message,
      chatHistory: input.chatHistory,
      imageDescription,
      imageFilename,
      reportContext: input.reportContext,
    });

    const { text: rawResponse } = await generateText({
      model: proModel,
      prompt,
    });

    // 4. Parse the delimiter-based response
    const summaryMatch = rawResponse.match(/<summary>([\s\S]*?)<\/summary>/);
    const texMatch = rawResponse.match(/<tex>\n?([\s\S]*?)\n?<\/tex>/);

    if (!texMatch?.[1]) {
      // Fallback: if the model returned something without delimiters, try to use it directly
      // (strip markdown fences if present)
      const fallbackTex = rawResponse
        .trim()
        .replace(/^```(?:latex)?\n?/, '')
        .replace(/\n?```$/, '');
      if (fallbackTex.includes('\\documentclass')) {
        logger.warn('Edit response missing delimiters, using raw response as tex', { reportId: input.reportId });
        return await compileAndStore(fallbackTex, 'Document updated.', input, imageBuffer, imageFilename);
      }
      throw new Error('AI response did not contain a valid LaTeX document');
    }

    const summary = summaryMatch?.[1]?.trim() ?? 'Document updated.';
    const modifiedTex = texMatch[1]
      .trim()
      .replace(/^```(?:latex)?\n?/, '')
      .replace(/\n?```$/, '');

    return await compileAndStore(modifiedTex, summary, input, imageBuffer, imageFilename);
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
  // 5. Download existing screenshots for compilation
  const screenshots = await prisma.screenshot.findMany({
    where: { reportId: input.reportId, excluded: false },
    orderBy: { index: 'asc' },
    select: { index: true, url: true },
  });

  const screenshotBuffers = await Promise.all(
    screenshots.map(async (s) => ({
      filename: `screenshot_${s.index}`,
      buffer: await downloadFromR2(s.url),
    })),
  );

  // Add the new image if provided
  const allImages = [...screenshotBuffers];
  if (imageBuffer && imageFilename) {
    allImages.push({ filename: imageFilename, buffer: imageBuffer });
  }

  // 6. Compile — use a unique prefix so each edit is stored in a distinct R2 key
  //    and older versions are not overwritten
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
