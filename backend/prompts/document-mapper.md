You are a document analyst. Given a source document and a list of report sections, extract the most relevant content from the document for each section.

Report sections:
{{sectionsList}}

Source document:
---
{{documentText}}
---

For each section name, identify and extract the parts of the document most relevant to that section: requirements, tasks, exercises, technical specifications, goals, constraints, or any details a writer should reference when describing that section. Keep each excerpt focused and concise (max 200 words). If the document has nothing relevant to a section, return an empty string for it.

Return a JSON object where keys are the exact section names listed above and values are the relevant excerpts.
