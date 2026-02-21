/**
 * Prompt loader — reads from external .md template files in /prompts/.
 * Templates use {{placeholder}} syntax for dynamic values.
 *
 * Path resolution works for both dev (ts-node, __dirname = src/pipeline)
 * and production (compiled, __dirname = dist/pipeline) — both resolve
 * ../../prompts to backend/prompts/.
 */
import { readFileSync } from 'fs';
import path from 'path';

type CustomFields = Record<string, { label: string; value: string }>;

interface LayoutConfig {
  header?: { left?: string; center?: string; right?: string };
  footer?: { left?: string; center?: string; right?: string };
  logoUrl?: string;
  logoPosition?: 'header-left' | 'header-right' | 'cover' | 'none';
}

function formatCustomFields(customFields?: CustomFields): string {
  if (!customFields || Object.keys(customFields).length === 0) return '';
  const lines = Object.values(customFields).map((f) => `${f.label}: ${f.value}`);
  return `\nAdditional context:\n${lines.join('\n')}`;
}

function styleDescription(style: string): string {
  const map: Record<string, string> = {
    professional: 'Tone: professional and business-appropriate — polished but not stiff. Think a well-written work report, not a corporate memo.',
    academic:     'Tone: academic and formal, suitable for a university submission. Precise vocabulary, clear argumentation.',
    technical:    'Tone: technical and implementation-focused. Prioritise accuracy and specificity over narrative flow. Be direct and concise.',
    casual:       'Tone: casual and personal. Write like you are telling a friend about your work, then lightly cleaned up. Simple vocabulary, natural rhythm, first-person throughout. Must feel genuinely human — not like a formal report.',
  };
  return map[style] ?? `Tone: ${style}.`;
}

function languageName(lang: string): string {
  const map: Record<string, string> = {
    'en':    'English',
    'pt':    'European Portuguese (Portugal)',
    'pt-br': 'Brazilian Portuguese',
    'es':    'Spanish',
    'fr':    'French',
    'de':    'German',
    'it':    'Italian',
    'nl':    'Dutch',
    'pl':    'Polish',
    'ru':    'Russian',
    'el':    'Greek',
    'cs':    'Czech',
    'sk':    'Slovak',
    'hu':    'Hungarian',
    'ro':    'Romanian',
    'tr':    'Turkish',
    'sv':    'Swedish',
    'no':    'Norwegian',
    'da':    'Danish',
    'fi':    'Finnish',
  };
  return map[lang?.toLowerCase()] ?? 'English';
}

const PROMPTS_DIR = path.join(__dirname, '../../prompts');

function load(name: string): string {
  return readFileSync(path.join(PROMPTS_DIR, `${name}.md`), 'utf-8');
}

// Eager load at startup — a missing file crashes immediately rather than at call time.
const templates = {
  screenshotAnalysis: load('screenshot-analysis'),
  cluster: load('cluster'),
  sectionWriter: load('section-writer'),
  introduction: load('introduction'),
  conclusion: load('conclusion'),
  editSections: load('edit-sections'),
  chatSystem: load('chat-system'),
  editModeSystem: load('edit-mode-system'),
  latexFix: load('latex-fix'),
  documentMapper: load('document-mapper'),
};

function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (!(key in vars)) throw new Error(`Prompt template references unknown placeholder: {{${key}}}`);
    return vars[key];
  });
}

// --- Vision prompts (Gemini Flash) ---

export function screenshotAnalysisPrompt(context: {
  projectName: string;
  description: string;
  techStack: string[];
  language: string;
  customFields?: CustomFields;
}): string {
  const techLine = context.techStack.length > 0
    ? `\nTech Stack: ${context.techStack.join(', ')}`
    : '';

  return fill(templates.screenshotAnalysis, {
    projectName: context.projectName,
    description: context.description || 'Not provided',
    techLine,
    languageName: languageName(context.language),
    customFields: formatCustomFields(context.customFields),
  });
}

// --- Cluster prompts (Gemini Pro) ---

export function clusterPrompt(context: {
  projectName: string;
  description: string;
  role: string;
  style: string;
  language: string;
  customFields?: CustomFields;
  screenshotDescriptions: { index: number; feature: string; description: string }[];
}): string {
  const screenshotsList = context.screenshotDescriptions
    .map((s) => `[${s.index}] Feature: ${s.feature}\n    Description: ${s.description}`)
    .join('\n\n');

  return fill(templates.cluster, {
    projectName: context.projectName,
    role: context.role || 'Professional',
    style: context.style,
    language: context.language,
    description: context.description || 'Not provided',
    customFields: formatCustomFields(context.customFields),
    screenshotsList,
  });
}

// --- Writer prompts (Gemini Pro) ---

export function sectionWriterPrompt(context: {
  projectName: string;
  role: string;
  company: string;
  sectionName: string;
  sectionDescription: string;
  screenshots: { index: number; feature: string; description: string }[];
  style: string;
  language: string;
  customFields?: CustomFields;
  documentContext?: string;
}): string {
  const screenshotsList = context.screenshots
    .map((s) => `Figure \\ref{fig:screenshot_${s.index}} — ${s.feature}\n   Description: ${s.description}`)
    .join('\n\n');

  const documentContext = context.documentContext?.trim()
    ? `\nRelevant context from uploaded documents:\n---\n${context.documentContext.trim()}\n---\n`
    : '';

  return fill(templates.sectionWriter, {
    style: context.style,
    styleDescription: styleDescription(context.style),
    projectName: context.projectName,
    company: context.company || 'Not specified',
    role: context.role || 'Professional',
    languageName: languageName(context.language),
    customFields: formatCustomFields(context.customFields),
    sectionName: context.sectionName,
    sectionDescription: context.sectionDescription,
    screenshotsList,
    documentContext,
  });
}

// --- Document mapping prompts (Gemini Flash) ---

export function documentMappingPrompt(context: {
  sections: { name: string; description: string }[];
  documentText: string;
  language: string;
}): string {
  const sectionsList = context.sections
    .map((s) => `- "${s.name}": ${s.description}`)
    .join('\n');

  return fill(templates.documentMapper, {
    sectionsList,
    documentText: context.documentText,
    language: languageName(context.language),
  });
}

export function introductionPrompt(context: {
  projectName: string;
  company: string;
  role: string;
  dates: string;
  description: string;
  techStack: string[];
  sections: string[];
  style: string;
  language: string;
  customFields?: CustomFields;
}): string {
  const techLine = context.techStack.length > 0
    ? `\nTechnologies: ${context.techStack.join(', ')}`
    : '';

  return fill(templates.introduction, {
    style: context.style,
    styleDescription: styleDescription(context.style),
    projectName: context.projectName,
    company: context.company || 'Not specified',
    role: context.role || 'Professional',
    dates: context.dates || 'Not specified',
    techLine,
    description: context.description || 'Not provided',
    languageName: languageName(context.language),
    customFields: formatCustomFields(context.customFields),
    sections: context.sections.join(', '),
  });
}

// --- Editor prompts (Gemini Flash) ---

export function editSectionsPrompt(context: {
  title: string;
  company: string;
  role: string;
  language: string;
  style: string;
  instruction: string;
  sectionContent: {
    introduction: string;
    sections: { sectionName: string; content: string; screenshotIndices?: number[] }[];
    conclusion: string;
  };
  screenshots?: { index: number; feature: string }[];
  chatHistory: { role: string; content: string }[];
  imageDescription?: string;
  imageFilename?: string;
  layoutConfig?: LayoutConfig;
}): string {
  const figureLabel = (idx: number): string => {
    const shot = context.screenshots?.find((s) => s.index === idx);
    return shot ? `\\ref{fig:screenshot_${idx}} (${shot.feature})` : `\\ref{fig:screenshot_${idx}}`;
  };

  const sectionHeader = (name: string, indices?: number[]): string => {
    if (!indices?.length || !context.screenshots?.length) return `[${name}]`;
    const refs = indices.map(figureLabel).join(', ');
    return `[${name}] — figures: ${refs}`;
  };

  const parts: string[] = [
    `[introduction]\n${context.sectionContent.introduction}`,
    ...context.sectionContent.sections.map((s) =>
      `${sectionHeader(s.sectionName, s.screenshotIndices)}\n${s.content}`
    ),
    `[conclusion]\n${context.sectionContent.conclusion}`,
  ];

  const historyLines = context.chatHistory
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const imageSection = context.imageDescription && context.imageFilename
    ? `\nThe user has attached an image. Description: ${context.imageDescription}\nFilename for reference: ${context.imageFilename}`
    : '';

  const lc = context.layoutConfig;
  const layoutConfigSection = lc ? `\nCurrent layout:\n- Header: left="${lc.header?.left ?? '(company)'}", center="${lc.header?.center ?? ''}", right="${lc.header?.right ?? '(title)'}"\n- Footer: left="${lc.footer?.left ?? ''}", center="${lc.footer?.center ?? 'page number'}", right="${lc.footer?.right ?? ''}"\n- Logo position: ${lc.logoPosition ?? 'none'}${lc.logoUrl ? ' (logo uploaded)' : ''}\n` : '';

  return fill(templates.editSections, {
    title: context.title || 'Unknown',
    company: context.company || 'Unknown',
    role: context.role || 'Unknown',
    language: languageName(context.language),
    styleDescription: styleDescription(context.style),
    historySection: historyLines ? `\nPrevious edits in this session:\n${historyLines}\n` : '',
    sectionsList: parts.join('\n\n---\n\n'),
    instruction: context.instruction,
    imageSection,
    layoutConfig: layoutConfigSection,
  });
}

export function conclusionPrompt(context: {
  projectName: string;
  sections: string[];
  sectionSummaries?: { name: string; opening: string }[];
  style: string;
  language: string;
}): string {
  const contextBlock = context.sectionSummaries && context.sectionSummaries.length > 0
    ? `Section summaries (opening of each written section):\n${
        context.sectionSummaries.map((s) => `${s.name}:\n${s.opening}...`).join('\n\n')
      }`
    : `Sections covered: ${context.sections.join(', ')}`;

  return fill(templates.conclusion, {
    style: context.style,
    styleDescription: styleDescription(context.style),
    projectName: context.projectName,
    contextBlock,
    languageName: languageName(context.language),
  });
}

// --- Chat prompts (Gemini Flash) ---

export function chatSystemPrompt(): string {
  return templates.chatSystem;
}

export function editModeSystemPrompt(hasImage: boolean): string {
  return fill(templates.editModeSystem, {
    imageInstruction: hasImage
      ? '\n- An image is attached. First determine its type: if it looks like a logo, emblem, seal, badge, crest, or icon (i.e. NOT a UI screenshot), call setLogo immediately — default position to "cover" unless the user says otherwise. If it is a UI screenshot intended to appear as a figure in the report, call addScreenshot. If it is only being used as context for a text edit, call editDocument.'
      : '',
  });
}

// --- LaTeX fix prompt (Gemini Pro) ---

export function latexFixPrompt(compilationError: string, texContent: string): string {
  return fill(templates.latexFix, { compilationError, texContent });
}
