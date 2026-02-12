import { generateText } from 'ai';
import { sectionWriterPrompt, introductionPrompt, conclusionPrompt } from './prompts';
import { proModel } from './ai';
import { logger } from '../utils/logger';
import { PipelineError } from '../utils/errors';
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

/**
 * Write prose content for each report section using Gemini Pro.
 * Also generates introduction and conclusion.
 */
export async function writeSections(input: WriterInput): Promise<WriterOutput> {
  const { sections, screenshots, context } = input;

  logger.info('Starting report writing', {
    sectionCount: sections.length,
    style: context.style,
    language: context.language,
  });

  try {
    // Write sections sequentially — avoids hitting Gemini Pro rate limits when there
    // are many sections (up to 8). Each section is a full Pro call; firing them all
    // at once (Promise.all) reliably hits the 2 RPM free-tier limit.
    const sectionContents: SectionContent[] = [];
    for (const section of sections) {
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

      sectionContents.push({
        sectionName: section.name,
        content: text,
        wordCount: text.split(/\s+/).length,
      });
    }

    // Write introduction
    logger.debug('Writing introduction');
    const { text: introduction } = await generateText({
      model: proModel,
      prompt: introductionPrompt({
        projectName: context.projectName,
        company: context.company,
        role: context.role,
        dates: context.dates,
        description: context.description,
        techStack: context.techStack,
        sections: sections.map((s) => s.name),
        style: context.style,
        language: context.language,
        customFields: context.customFields,
      }),
    });

    // Write conclusion
    logger.debug('Writing conclusion');
    const { text: conclusion } = await generateText({
      model: proModel,
      prompt: conclusionPrompt({
        projectName: context.projectName,
        sections: sections.map((s) => s.name),
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
