import { generateText, Output } from 'ai';
import sharp from 'sharp';
import { screenshotAnalysisItemSchema } from './schemas';
import { screenshotAnalysisPrompt } from './prompts';
import { flashModel } from './ai';
import { logger } from '../utils/logger';
import { PipelineError } from '../utils/errors';
import { concurrentMap } from '../utils/concurrent';
import type { ScreenshotAnalysis, ScreenshotAnalysisItem } from './schemas';

interface VisionInput {
  screenshots: {
    index: number;
    imageBuffer: Buffer;
  }[];
  context: {
    projectName: string;
    description: string;
    techStack: string[];
    language: string;
    customFields?: Record<string, { label: string; value: string }>;
  };
}

// Max pixel width sent to Gemini Flash — sufficient for UI analysis, much smaller payload.
// The original full-res buffer is untouched in memory for PDF embedding.
const VISION_MAX_WIDTH = 1280;

// Max concurrent Gemini Flash calls. Flash allows 1000 RPM on paid tier;
// 10 concurrent is conservative and keeps Node's connection pool comfortable.
const VISION_CONCURRENCY = 10;

/**
 * Analyze screenshots using Gemini Flash vision model.
 * Generates structured descriptions of each screenshot's content, features, and UI elements.
 *
 * All screenshots are analyzed concurrently (up to VISION_CONCURRENCY at a time).
 * Each call receives a single image resized to VISION_MAX_WIDTH — one result per call,
 * index assigned by us, so there is no risk of model index mismatch.
 */
export async function analyzeScreenshots(input: VisionInput): Promise<ScreenshotAnalysis> {
  const { screenshots, context } = input;

  logger.info('Starting screenshot analysis', {
    count: screenshots.length,
    projectName: context.projectName,
    concurrency: VISION_CONCURRENCY,
  });

  try {
    const prompt = screenshotAnalysisPrompt(context);

    const allResults = await concurrentMap(
      screenshots,
      VISION_CONCURRENCY,
      async (screenshot): Promise<ScreenshotAnalysisItem | null> => {
        logger.debug('Analyzing screenshot', { index: screenshot.index });

        // Resize to max VISION_MAX_WIDTH before sending to Gemini.
        // Smaller payload = faster network transfer + fewer image tokens billed.
        // Original buffer is preserved separately for full-res PDF embedding.
        const resized = await sharp(screenshot.imageBuffer)
          .resize({ width: VISION_MAX_WIDTH, withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();

        const result = await generateText({
          model: flashModel,
          output: Output.object({ schema: screenshotAnalysisItemSchema }),
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                { type: 'image', image: resized },
              ],
            },
          ],
        });

        const output = (result as any).output as ScreenshotAnalysisItem | undefined;
        if (!output) {
          logger.warn('Vision model returned no output for screenshot — skipping', { index: screenshot.index });
          return null;
        }

        // Always use our index — never rely on the model to return the correct one.
        return { ...output, index: screenshot.index };
      },
    );

    const filtered = allResults.filter((r): r is ScreenshotAnalysisItem => r !== null);

    if (filtered.length === 0) {
      throw new Error('Vision analysis returned no results for any screenshot');
    }

    logger.info('Screenshot analysis complete', { analyzed: filtered.length, total: screenshots.length });

    return { screenshots: filtered };
  } catch (error) {
    logger.error('Vision analysis failed', { error });
    throw new PipelineError('vision', `Failed to analyze screenshots: ${(error as Error).message}`);
  }
}
