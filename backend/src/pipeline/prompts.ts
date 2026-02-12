/**
 * Centralized prompt templates for all AI pipeline stages.
 * Version: 2.0.0
 *
 * Convention: Each prompt is a function that accepts context parameters
 * and returns a formatted string. This keeps prompts testable and versionable.
 */

type CustomFields = Record<string, { label: string; value: string }>;

function formatCustomFields(customFields?: CustomFields): string {
  if (!customFields || Object.keys(customFields).length === 0) return '';
  const lines = Object.values(customFields).map((f) => `${f.label}: ${f.value}`);
  return `\nAdditional context:\n${lines.join('\n')}`;
}

function languageName(lang: string): string {
  return lang === 'pt' ? 'Brazilian Portuguese'
    : lang === 'es' ? 'Spanish'
    : lang === 'fr' ? 'French'
    : lang === 'de' ? 'German'
    : 'English';
}

// --- Vision prompts (Gemini Flash) ---

export function screenshotAnalysisPrompt(context: {
  projectName: string;
  description: string;
  techStack: string[];
  customFields?: CustomFields;
}): string {
  const techLine = context.techStack.length > 0
    ? `\nTech Stack: ${context.techStack.join(', ')}`
    : '';

  return `You are an expert analyst reviewing a screenshot from a project or work report.

Project: ${context.projectName}
Description: ${context.description || 'Not provided'}${techLine}${formatCustomFields(context.customFields)}

Analyze this single screenshot and identify:
1. The main feature or functionality being shown — give it a concise name (e.g. "User Authentication", "Dashboard Overview", "Payment Flow")
2. A detailed description covering two things: (a) what is visible on screen, and (b) what the developer is DEMONSTRATING with this screenshot — the purpose of showing it, not just what's there
3. Key UI elements present (buttons, forms, charts, modals, tables, navigation, etc.)
4. If this appears to be part of a multi-step workflow, note which step and what the flow is
5. Any technical or domain-specific details visible (API data, code, database output, configurations, etc.)

Be specific and report-ready — your analysis will be used directly to write professional prose about this feature. Avoid generic descriptions like "the screen shows a form". Instead say what the form does, why it matters, and what it proves about the project.`;
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
  return `You are a report architect. Given a set of analyzed images from a project or work report, group them into logical sections.

Project: ${context.projectName}
Role: ${context.role || 'Professional'}
Report Style: ${context.style}
Language: ${context.language}
Description: ${context.description || 'Not provided'}${formatCustomFields(context.customFields)}

Images analyzed:
${context.screenshotDescriptions
  .map((s) => `[${s.index}] Feature: ${s.feature}\n    Description: ${s.description}`)
  .join('\n\n')}

Tasks:
1. Group the images into 3-8 logical sections for a ${context.style} report
2. Order sections in a logical narrative flow
3. Suggest a report title
4. Write a brief abstract (2-3 sentences)

Each section should have a clear theme and contain related images. Sections should tell a coherent story about the work or project.`;
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
}): string {
  return `You are a professional writer creating a ${context.style} report section.

Project: ${context.projectName}
Organization: ${context.company || 'Not specified'}
Role: ${context.role || 'Professional'}
Language: Write in ${languageName(context.language)}
Style: ${context.style}${formatCustomFields(context.customFields)}

Section: "${context.sectionName}"
Section Purpose: ${context.sectionDescription}

Images in this section:
${context.screenshots
  .map((s) => `Figure \\ref{fig:screenshot_${s.index}} — ${s.feature}\n   Description: ${s.description}`)
  .join('\n\n')}

Write a detailed, well-structured section (300-600 words) that:
1. Explains what is shown in the images
2. Discusses relevant decisions, methodology, or implementation approach
3. References figures using the exact \\ref{fig:screenshot_INDEX} labels shown above — do not invent or renumber them
4. Uses a ${context.style} tone throughout
5. Includes appropriate depth for a ${context.style} report

Output the section content as LaTeX-compatible text (no section headers — those will be added by the template). Use \\textbf{} for emphasis, \\texttt{} for technical terms or code, and itemize/enumerate environments where appropriate.

CRITICAL: Never output document-level LaTeX commands (\\documentclass, \\usepackage, \\begin{document}, \\end{document}, \\maketitle, etc.). If showing code examples, wrap them in \\begin{verbatim}...\\end{verbatim}.`;
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

  return `Write an introduction for a ${context.style} report.

Project: ${context.projectName}
Organization: ${context.company || 'Not specified'}
Role: ${context.role || 'Professional'}
Period: ${context.dates || 'Not specified'}${techLine}
Description: ${context.description || 'Not provided'}
Language: Write in ${languageName(context.language)}${formatCustomFields(context.customFields)}

Report sections that follow: ${context.sections.join(', ')}

Write 200-400 words covering:
1. Context of the project, internship, or work
2. Objectives and scope
3. Brief overview of what will be covered

Use a ${context.style} tone. Output as LaTeX-compatible text. Never output document-level LaTeX commands (\\documentclass, \\usepackage, \\begin{document}, etc.). Do NOT include a section title or heading — it is added by the template.`;
}

// --- Editor prompts (Gemini Pro) ---

export function editDocumentPrompt(context: {
  texContent: string;
  instruction: string;
  chatHistory: { role: string; content: string }[];
  imageDescription?: string;
  imageFilename?: string;
  reportContext: {
    title?: string | null;
    company?: string | null;
    role?: string | null;
    language: string;
    style: string;
  };
}): string {
  const historyLines = context.chatHistory
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const imageSection = context.imageDescription && context.imageFilename
    ? `\nThe user has attached an image. Description: ${context.imageDescription}\nIn LaTeX, reference it as \\includegraphics{${context.imageFilename}} (it will be available during compilation).`
    : '';

  const historySection = historyLines
    ? `\nPrevious edits in this session:\n${historyLines}\n`
    : '';

  return `You are a LaTeX document editor. You will make a targeted edit to the document below based on the user's instruction.

Report context:
- Title: ${context.reportContext.title || 'Unknown'}
- Organization: ${context.reportContext.company || 'Unknown'}
- Role: ${context.reportContext.role || 'Unknown'}
- Language: ${context.reportContext.language}
- Style: ${context.reportContext.style}
${historySection}${imageSection}

User instruction: "${context.instruction}"

Current LaTeX document:
${context.texContent}

Rules:
1. Make ONLY the changes needed to fulfill the instruction. Leave everything else exactly as-is.
2. Preserve all \\usepackage, \\documentclass, \\begin{document}, \\end{document} and other structural commands.
3. Preserve all \\label{} and \\ref{} commands exactly — do not renumber or rename them.
4. If shortening prose, keep the section structure and figure references intact.
5. If adding an image, use the exact filename provided (no extension needed for \\includegraphics).
6. Keep all text in the document's language (${context.reportContext.language}).

Return your response in EXACTLY this format with no other text:
<summary>One sentence describing what you changed</summary>
<tex>
[complete modified LaTeX document]
</tex>`;
}

export function conclusionPrompt(context: {
  projectName: string;
  sections: string[];
  style: string;
  language: string;
}): string {
  return `Write a conclusion for a ${context.style} report about "${context.projectName}".

Sections covered: ${context.sections.join(', ')}
Language: Write in ${languageName(context.language)}

Write 150-300 words covering:
1. Summary of work completed
2. Key achievements and contributions
3. Lessons learned
4. Potential future improvements or next steps

Use a ${context.style} tone. Output as LaTeX-compatible text. Never output document-level LaTeX commands (\\documentclass, \\usepackage, \\begin{document}, etc.). Do NOT include a section title or heading — it is added by the template.`;
}
