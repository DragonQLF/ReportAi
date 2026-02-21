import { generateText, Output } from 'ai';
import { z } from 'zod';
import { flashModel } from './ai';
import { documentMappingPrompt } from './prompts';
import { logger } from '../utils/logger';

interface DocMapperInput {
  sections: { name: string; description: string }[];
  documentText: string;
  language: string;
}

/**
 * Map relevant document excerpts to each report section.
 * One Flash call reads the full document + section list and returns
 * a per-section excerpt so each section writer gets focused context
 * rather than the full document.
 */
export async function mapDocumentToSections(
  input: DocMapperInput,
): Promise<Record<string, string>> {
  const { sections, documentText, language } = input;

  if (!documentText.trim() || sections.length === 0) return {};

  logger.info('Running document mapping pass', { sectionCount: sections.length });

  const prompt = documentMappingPrompt({ sections, documentText, language });

  const schema = z.record(z.string(), z.string());

  const result = await generateText({
    model: flashModel,
    output: Output.object({ schema }),
    prompt,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapping = (result as any).output as Record<string, string> | undefined;

  if (!mapping) {
    logger.warn('Document mapping returned no output — skipping context injection');
    return {};
  }

  logger.info('Document mapping complete', {
    sections: Object.keys(mapping).length,
    nonEmpty: Object.values(mapping).filter(Boolean).length,
  });

  return mapping;
}
