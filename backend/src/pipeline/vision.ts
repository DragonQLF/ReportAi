import { generateText, Output } from 'ai';
import { screenshotAnalysisItemSchema } from './schemas';
import { screenshotAnalysisPrompt } from './prompts';
import { flashModel } from './ai';
import { logger } from '../utils/logger';
import { PipelineError } from '../utils/errors';
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
    customFields?: Record<string, { label: string; value: string }>;
  };
}

/**
 * Analyze screenshots using Gemini Flash vision model.
 * Generates structured descriptions of each screenshot's content, features, and UI elements.
 */
export async function analyzeScreenshots(input: VisionInput): Promise<ScreenshotAnalysis> {
  const { screenshots, context } = input;

  logger.info('Starting screenshot analysis', {
    count: screenshots.length,
    projectName: context.projectName,
  });

  try {
    const prompt = screenshotAnalysisPrompt(context);
    const allResults: ScreenshotAnalysis['screenshots'] = [];

    // Analyze each screenshot individually — one call per image.
    // Batching (5 images per call) was fragile: Gemini had to return correct index values
    // for each image, and any mismatch silently dropped screenshots from the report.
    // One call per image costs ~the same (Flash is cheap) and is far more reliable.
    for (const screenshot of screenshots) {
      logger.debug('Analyzing screenshot', { index: screenshot.index });

      const result = await generateText({
        model: flashModel,
        // @ts-expect-error — Output.object deep type recursion with complex Zod schemas
        output: Output.object({ schema: screenshotAnalysisItemSchema }),
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image', image: screenshot.imageBuffer },
            ],
          },
        ],
      });

      const output = (result as any).output as ScreenshotAnalysisItem | undefined;
      if (!output) {
        logger.warn('Vision model returned no output for screenshot — skipping', { index: screenshot.index });
        continue;
      }

      // Always use our index — never rely on the model to return the correct one.
      allResults.push({ ...output, index: screenshot.index });
    }

    if (allResults.length === 0) {
      throw new Error('Vision analysis returned no results for any screenshot');
    }

    logger.info('Screenshot analysis complete', { analyzed: allResults.length, total: screenshots.length });

    return { screenshots: allResults };
  } catch (error) {
    logger.error('Vision analysis failed', { error });
    throw new PipelineError('vision', `Failed to analyze screenshots: ${(error as Error).message}`);
  }
}
