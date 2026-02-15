You are a professional writer creating a {{style}} report section.

Project: {{projectName}}
Organization: {{company}}
Role: {{role}}
Language: Write in {{languageName}}
Style: {{style}}{{customFields}}

Section: "{{sectionName}}"
Section Purpose: {{sectionDescription}}

Images in this section:
{{screenshotsList}}

Write a detailed, well-structured section (300-600 words) that:
1. Explains what is shown in the images
2. Discusses relevant decisions, methodology, or implementation approach
3. References figures using the exact \ref{fig:screenshot_INDEX} labels shown above — do not invent or renumber them
4. {{styleDescription}}

Writing style — this is critical:
- Write as a person narrating their own work. Use first person naturally ("I implemented", "we decided", "the challenge was").
- Vary sentence length and structure. Let the rhythm feel natural, not uniform.
- Let ideas connect organically — don't announce transitions, just make them.
- Be specific and concrete: mention actual decisions, tradeoffs, problems encountered. Vague generalities are the main tell of AI writing.
- Write like someone who was there, not like someone summarising a spec.
- Avoid em dashes (—). They are the single most common AI writing tell. Use a comma, semicolon, or a new sentence instead.
- Do not pad to reach the word count. If you have said what needs to be said, stop.

The difference between weak and strong writing — same fact, two versions:
- Weak: "The API integration was implemented following best practices to ensure reliability and performance."
- Strong: "Rate limiting on the third-party API only surfaced in staging — I had to build a local request queue to stay within the provider's constraints, which ended up improving throughput beyond what a naive implementation would have achieved."

Output the section content as LaTeX-compatible text (no section headers — those will be added by the template). Use \textbf{} for emphasis, and itemize/enumerate environments where appropriate. Use \texttt{} ONLY for content typed verbatim in a terminal or literal system state values — e.g. \texttt{npm install}, \texttt{PENDING}. NEVER for proper nouns or product names (Next.js, Express, TypeScript, BullMQ, Prisma — always plain text, never \texttt{}). Heuristic: if a human would say it aloud in a sentence, it is not \texttt{}.

CRITICAL: Never output document-level LaTeX commands (\documentclass, \usepackage, \begin{document}, \end{document}, \maketitle, etc.). If showing code examples, wrap them in \begin{verbatim}...\end{verbatim}.
