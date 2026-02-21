import { z } from 'zod';

// --- Reviewer stage ---

export const reviewResultSchema = z.object({
  screenshotId: z.string(),
  index: z.number(),
  blurScore: z.number().min(0).max(1),
  isDuplicate: z.boolean(),
  duplicateOf: z.number().nullable(),
  keep: z.boolean(),
  reason: z.string().optional(),
});

export const reviewOutputSchema = z.object({
  results: z.array(reviewResultSchema),
  keptCount: z.number(),
  removedCount: z.number(),
});

export type ReviewResult = z.infer<typeof reviewResultSchema>;
export type ReviewOutput = z.infer<typeof reviewOutputSchema>;

// --- Vision stage (screenshot analysis) ---

export const screenshotAnalysisItemSchema = z.object({
  index: z.number(),
  imageType: z.enum(['screenshot', 'logo', 'photo', 'diagram', 'other'])
    .describe('Type of image: "screenshot" for UI/app screenshots; "logo" for logos, emblems, seals, badges, crests, or institutional insignia; "photo" for real-world photographs; "diagram" for technical diagrams, charts, or wireframes; "other" for anything else'),
  feature: z.string().describe('The main feature or UI element visible in the screenshot'),
  description: z.string().describe('A detailed description of what the screenshot shows'),
  uiElements: z.array(z.string()).describe('Key UI elements identified'),
  technicalDetails: z.string().optional().describe('Any technical implementation details visible'),
});

export const screenshotAnalysisSchema = z.object({
  screenshots: z.array(screenshotAnalysisItemSchema),
});

export type ScreenshotAnalysisItem = z.infer<typeof screenshotAnalysisItemSchema>;
export type ScreenshotAnalysis = z.infer<typeof screenshotAnalysisSchema>;

// --- Cluster stage (section grouping) ---

export const sectionSchema = z.object({
  name: z.string().describe('Section title for the report'),
  description: z.string().describe('Brief description of what this section covers'),
  screenshotIndices: z.array(z.number()).describe('Indices of screenshots belonging to this section'),
  order: z.number().describe('Order of this section in the report'),
  screenshotPairs: z.array(z.array(z.number())).optional().default([]).describe('Pairs of screenshot indices to render side-by-side in minipage columns'),
});

export const clusterOutputSchema = z.object({
  sections: z.array(sectionSchema),
  reportTitle: z.string().describe('Suggested report title'),
  abstract: z.string().describe('Brief abstract/summary for the report'),
});

export type Section = z.infer<typeof sectionSchema>;
export type ClusterOutput = z.infer<typeof clusterOutputSchema>;

// --- Writer stage ---

export const sectionContentSchema = z.object({
  sectionName: z.string(),
  content: z.string().describe('The full prose content for this section in LaTeX-compatible format'),
  wordCount: z.number(),
});

export const writerOutputSchema = z.object({
  sections: z.array(sectionContentSchema),
  introduction: z.string(),
  conclusion: z.string(),
});

export type SectionContent = z.infer<typeof sectionContentSchema>;
export type WriterOutput = z.infer<typeof writerOutputSchema>;

// --- LaTeX stage ---

export const latexOutputSchema = z.object({
  texContent: z.string(),
  pdfBuffer: z.instanceof(Buffer).optional(),
  pdfUrl: z.string().optional(),
  texUrl: z.string().optional(),
});

export type LatexOutput = z.infer<typeof latexOutputSchema>;

// --- Pipeline context (shared across stages) ---

export const pipelineContextSchema = z.object({
  reportId: z.string(),
  title: z.string().optional(),
  company: z.string().optional(),
  role: z.string().optional(),
  dates: z.string().optional(),
  techStack: z.array(z.string()),
  description: z.string().optional(),
  language: z.string(),
  style: z.string(),
  font: z.string().default('default'),
  customFields: z.record(z.string(), z.object({ label: z.string(), value: z.string() })).optional(),
});

export type PipelineContext = z.infer<typeof pipelineContextSchema>;
