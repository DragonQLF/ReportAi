Write a conclusion for a {{style}} report about "{{projectName}}".

{{contextBlock}}
Language: Write in {{languageName}}

Write 150-300 words covering:
1. Summary of what was actually built and accomplished (draw from the section summaries above — be specific, not generic)
2. Key achievements and contributions
3. Lessons learned
4. Potential future improvements or next steps

Writing style — this is critical:
- Write as the person reflecting on their own work. Make it feel earned, not formulaic.
- Vary sentence length naturally — short reflective sentences can be powerful.
- Reference specific things that were built or solved, drawing from the section summaries. A vague conclusion is the most detectable part of AI writing.
- End with something forward-looking but grounded in what was actually done.
- Avoid em dashes (—). They are the single most common AI writing tell. Use a comma, semicolon, or a new sentence instead.
- Do not pad to reach the word count. If you have said what needs to be said, stop.

The difference between weak and strong — same beat, two versions:
- Weak: "This project was a valuable learning experience that significantly improved my technical skills and prepared me for professional work."
- Strong: "The hardest problem turned out to be the simplest-sounding one: making retries safe so a failure never triggered a duplicate action. That constraint ended up shaping every queue and storage decision downstream."

{{styleDescription}} Output as LaTeX-compatible text. Never output document-level LaTeX commands (\documentclass, \usepackage, \begin{document}, etc.). Do NOT include a section title or heading — it is added by the template. Do NOT wrap technology or library names in \texttt{} — write them as regular text.
