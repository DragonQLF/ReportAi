import { generateText, Output } from 'ai';
import { clusterOutputSchema } from './schemas';
import { clusterPrompt } from './prompts';
import { proModel } from './ai';
import { logger } from '../utils/logger';
import { PipelineError } from '../utils/errors';
import type { ClusterOutput, ScreenshotAnalysisItem } from './schemas';

interface ClusterInput {
  screenshots: ScreenshotAnalysisItem[];
  context: {
    projectName: string;
    description: string;
    role: string;
    style: string;
    language: string;
    customFields?: Record<string, { label: string; value: string }>;
  };
}

/**
 * Group analyzed screenshots into logical report sections using Gemini Pro.
 * Determines section structure, ordering, report title, and abstract.
 */
export async function clusterScreenshots(input: ClusterInput): Promise<ClusterOutput> {
  const { screenshots, context } = input;

  logger.info('Starting screenshot clustering', {
    screenshotCount: screenshots.length,
    style: context.style,
  });

  try {
    const prompt = clusterPrompt({
      ...context,
      screenshotDescriptions: screenshots.map((s) => ({
        index: s.index,
        feature: s.feature,
        description: s.description,
      })),
    });

    const result = await generateText({
      model: proModel,
      // @ts-expect-error — Output.object deep type recursion with complex Zod schemas
      output: Output.object({ schema: clusterOutputSchema }),
      prompt,
    });

    const output = (result as any).output as ClusterOutput | undefined;
    if (!output) {
      throw new Error('Clustering model returned no structured output');
    }

    logger.info('Clustering complete', {
      sections: output.sections.length,
      title: output.reportTitle,
    });

    return output;
  } catch (error) {
    logger.error('Clustering failed', { error });
    throw new PipelineError('cluster', `Failed to cluster screenshots: ${(error as Error).message}`);
  }
}
