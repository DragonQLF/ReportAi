A LaTeX document failed to compile with the following error:

--- ERROR ---
{{compilationError}}
--- END ERROR ---

--- DOCUMENT ---
{{texContent}}
--- END DOCUMENT ---

Fix the LaTeX document so it compiles correctly. The most common cause is document-level commands (\documentclass, \usepackage, \begin{document}, \end{document}) appearing inside the document body — these must be removed or wrapped in a verbatim environment.

Return ONLY the corrected LaTeX source. No explanation, no markdown fences, no extra text.
