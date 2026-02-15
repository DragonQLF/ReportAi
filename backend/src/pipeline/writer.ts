import { generateText } from 'ai';
import { sectionWriterPrompt, introductionPrompt, conclusionPrompt } from './prompts';
import { flashModel, proModel } from './ai';
import { logger } from '../utils/logger';
import { PipelineError } from '../utils/errors';
import { concurrentMap } from '../utils/concurrent';
import type { Section, ScreenshotAnalysisItem, WriterOutput, SectionContent } from './schemas';

interface WriterInput {
  sections: Section[];
  screenshots: ScreenshotAnalysisItem[];
  context: {
    projectName: string;
    company: string;
    role: string;
    dates: string;
    description: string;
    techStack: string[];
    style: string;
    language: string;
    customFields?: Record<string, { label: string; value: string }>;
  };
}

// Max concurrent Gemini Pro calls for section writing.
// Keep this low — Pro has tighter rate limits than Flash.
// On free tier: 2 RPM, so 1 is forced. On paid tier: 3 gives a ~3x speedup.
const WRITER_CONCURRENCY = 3;

/**
 * Write prose content for each report section using Gemini Pro.
 * Sections and introduction run in parallel (intro only needs section names).
 * Conclusion runs after sections finish — it receives the opening paragraph of
 * each section so it can reference what was actually written rather than just names.
 */
export async function writeSections(input: WriterInput): Promise<WriterOutput> {
  const { sections, screenshots, context } = input;

  logger.info('Starting report writing', {
    sectionCount: sections.length,
    style: context.style,
    language: context.language,
    concurrency: WRITER_CONCURRENCY,
  });

  try {
    const sectionNames = sections.map((s) => s.name);

    // Sections and introduction run in parallel — intro only needs section names.
    logger.debug('Writing sections and introduction in parallel');

    const [sectionContents, { text: introduction }] = await Promise.all([
      concurrentMap(
        sections,
        WRITER_CONCURRENCY,
        async (section): Promise<SectionContent> => {
          const sectionScreenshots = section.screenshotIndices
            .map((idx) => screenshots.find((s) => s.index === idx))
            .filter((s): s is ScreenshotAnalysisItem =>
              s !== undefined && !!s.feature && !!s.description
            );

          if (sectionScreenshots.length === 0) {
            logger.warn('No analyzed screenshots for section — writing without visuals', {
              sectionName: section.name,
            });
          }

          const prompt = sectionWriterPrompt({
            projectName: context.projectName,
            role: context.role,
            company: context.company,
            sectionName: section.name,
            sectionDescription: section.description,
            screenshots: sectionScreenshots.map((s) => ({
              index: s.index,
              feature: s.feature,
              description: s.description,
            })),
            style: context.style,
            language: context.language,
            customFields: context.customFields,
          });

          logger.debug('Writing section', { sectionName: section.name });

          const { text } = await generateText({
            model: proModel,
            prompt,
          });

          return {
            sectionName: section.name,
            content: text,
            wordCount: text.split(/\s+/).length,
          };
        },
      ),
      generateText({
        model: flashModel,
        prompt: introductionPrompt({
          projectName: context.projectName,
          company: context.company,
          role: context.role,
          dates: context.dates,
          description: context.description,
          techStack: context.techStack,
          sections: sectionNames,
          style: context.style,
          language: context.language,
          customFields: context.customFields,
        }),
      }),
    ]);

    // Conclusion runs after sections — pass the opening ~80 words of each section
    // so it can reference what was actually written rather than just section names.
    logger.debug('Writing conclusion with section summaries');

    const sectionSummaries = sectionContents.map((sc) => ({
      name: sc.sectionName,
      opening: sc.content.split(/\s+/).slice(0, 80).join(' '),
    }));

    const { text: conclusion } = await generateText({
      model: flashModel,
      prompt: conclusionPrompt({
        projectName: context.projectName,
        sections: sectionNames,
        sectionSummaries,
        style: context.style,
        language: context.language,
      }),
    });

    logger.info('Report writing complete', {
      sections: sectionContents.length,
      totalWords: sectionContents.reduce((sum, s) => sum + s.wordCount, 0),
    });

    return {
      sections: sectionContents,
      introduction,
      conclusion,
    };
  } catch (error) {
    logger.error('Report writing failed', { error });
    throw new PipelineError('writer', `Failed to write report: ${(error as Error).message}`);
  }
}
