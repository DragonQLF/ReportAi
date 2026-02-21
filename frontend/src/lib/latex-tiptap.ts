/**
 * Bidirectional converter: LaTeX prose string ↔ TipTap JSON.
 *
 * LaTeX inline commands handled: \textbf{}, \textit{}, \texttt{}, \ref{fig:screenshot_N}, \\
 * Block environments handled:    \begin{itemize}, \begin{enumerate}, \begin{verbatim}
 */
import type { JSONContent } from '@tiptap/core';

export interface ScreenshotInfo {
  index: number;
  feature: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

/**
 * Find content inside balanced curly braces.
 * `start` must be the index of the opening `{`.
 * Returns { content, end } where `end` is the index of the matching `}`.
 */
function extractBraceContent(
  str: string,
  start: number,
): { content: string; end: number } | null {
  if (str[start] !== '{') return null;
  let depth = 0;
  let content = '';
  for (let i = start; i < str.length; i++) {
    const ch = str[i];
    if (ch === '{') {
      depth++;
      if (depth === 1) continue; // skip the opening brace itself
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return { content, end: i };
    }
    if (depth > 0) content += ch;
  }
  return null;
}

// ─── inline parser  (LaTeX string → TipTap inline nodes) ────────────────────

function parseInline(text: string, screenshotMap: Map<number, string>): JSONContent[] {
  const nodes: JSONContent[] = [];
  let i = 0;
  let plain = '';

  const flushPlain = () => {
    if (plain) {
      nodes.push({ type: 'text', text: plain });
      plain = '';
    }
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch !== '\\') {
      plain += ch;
      i++;
      continue;
    }

    // hard break: \\
    if (text[i + 1] === '\\') {
      flushPlain();
      nodes.push({ type: 'hardBreak' });
      i += 2;
      continue;
    }

    // \ref{fig:screenshot_N}
    if (text.startsWith('\\ref{', i)) {
      const braceIdx = i + 4; // index of '{'
      const result = extractBraceContent(text, braceIdx);
      if (result) {
        flushPlain();
        const label = result.content;
        const idxMatch = label.match(/screenshot_(\d+)/);
        const idx = idxMatch ? parseInt(idxMatch[1], 10) : -1;
        const feature = screenshotMap.get(idx) ?? label;
        nodes.push({ type: 'figureRef', attrs: { index: idx, feature } });
        i = result.end + 1;
        continue;
      }
    }

    // \textbf{...}
    if (text.startsWith('\\textbf{', i)) {
      const result = extractBraceContent(text, i + 7);
      if (result) {
        flushPlain();
        const inner = parseInline(result.content, screenshotMap);
        for (const n of inner) {
          nodes.push({ ...n, marks: [...(n.marks ?? []), { type: 'bold' }] });
        }
        i = result.end + 1;
        continue;
      }
    }

    // \textit{...}
    if (text.startsWith('\\textit{', i)) {
      const result = extractBraceContent(text, i + 7);
      if (result) {
        flushPlain();
        const inner = parseInline(result.content, screenshotMap);
        for (const n of inner) {
          nodes.push({ ...n, marks: [...(n.marks ?? []), { type: 'italic' }] });
        }
        i = result.end + 1;
        continue;
      }
    }

    // \texttt{...}
    if (text.startsWith('\\texttt{', i)) {
      const result = extractBraceContent(text, i + 7);
      if (result) {
        flushPlain();
        nodes.push({ type: 'text', text: result.content, marks: [{ type: 'code' }] });
        i = result.end + 1;
        continue;
      }
    }

    // unrecognised backslash — pass through literally
    plain += ch;
    i++;
  }

  flushPlain();
  return nodes.length ? nodes : [{ type: 'text', text: '' }];
}

// ─── block parser  (LaTeX string → TipTap block nodes) ─────────────────────

function parseBlocks(content: string, screenshotMap: Map<number, string>): JSONContent[] {
  const nodes: JSONContent[] = [];
  let pos = 0;

  while (pos < content.length) {
    const beginIdx = content.indexOf('\\begin{', pos);
    const textEnd = beginIdx === -1 ? content.length : beginIdx;

    // Text before the next \begin (or end of string) — split into paragraphs
    if (textEnd > pos) {
      const chunk = content.slice(pos, textEnd);
      for (const para of chunk.split(/\n\n+/)) {
        const trimmed = para.trim();
        if (trimmed) {
          nodes.push({ type: 'paragraph', content: parseInline(trimmed, screenshotMap) });
        }
      }
    }

    if (beginIdx === -1) break;

    // \begin{ is 7 chars: \, b, e, g, i, n, {  → beginIdx+6 = index of {
    const envNameResult = extractBraceContent(content, beginIdx + 6);
    if (!envNameResult) { pos = beginIdx + 7; continue; }

    const envName = envNameResult.content;
    const endTag = `\\end{${envName}}`;
    const bodyStart = envNameResult.end + 1;
    const bodyEnd = content.indexOf(endTag, bodyStart);
    if (bodyEnd === -1) { pos = beginIdx + 7; continue; }

    const body = content.slice(bodyStart, bodyEnd).trim();
    pos = bodyEnd + endTag.length;

    if (envName === 'itemize' || envName === 'enumerate') {
      const listType = envName === 'itemize' ? 'bulletList' : 'orderedList';
      const items: JSONContent[] = [];
      for (const part of body.split(/\\item\s*/)) {
        const t = part.trim();
        if (t) {
          items.push({
            type: 'listItem',
            content: [{ type: 'paragraph', content: parseInline(t, screenshotMap) }],
          });
        }
      }
      if (items.length) nodes.push({ type: listType, content: items });
    } else if (envName === 'verbatim') {
      nodes.push({ type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: body }] });
    } else {
      nodes.push({ type: 'paragraph', content: parseInline(body, screenshotMap) });
    }
  }

  return nodes;
}

// ─── public: LaTeX → TipTap ─────────────────────────────────────────────────

export function latexToTiptap(content: string, screenshots: ScreenshotInfo[]): JSONContent {
  const screenshotMap = new Map(screenshots.map((s) => [s.index, s.feature]));
  const blocks = parseBlocks(content, screenshotMap);
  return {
    type: 'doc',
    content: blocks.length
      ? blocks
      : [{ type: 'paragraph', content: [{ type: 'text', text: '' }] }],
  };
}

// ─── public: TipTap → LaTeX ─────────────────────────────────────────────────

function inlineToLatex(nodes: JSONContent[] | undefined): string {
  if (!nodes) return '';
  return nodes
    .map((node) => {
      if (node.type === 'figureRef') {
        return `\\ref{fig:screenshot_${node.attrs?.index}}`;
      }
      if (node.type === 'hardBreak') return '\\\\';
      if (node.type === 'text') {
        const raw = node.text ?? '';
        const bold   = node.marks?.some((m) => m.type === 'bold');
        const italic = node.marks?.some((m) => m.type === 'italic');
        const code   = node.marks?.some((m) => m.type === 'code');
        let result = raw;
        if (code)   result = `\\texttt{${result}}`;
        if (bold)   result = `\\textbf{${result}}`;
        if (italic) result = `\\textit{${result}}`;
        return result;
      }
      return inlineToLatex(node.content);
    })
    .join('');
}

function nodeToLatex(node: JSONContent): string {
  switch (node.type) {
    case 'paragraph':
      return inlineToLatex(node.content);
    case 'bulletList': {
      const items = (node.content ?? [])
        .map((item) => `\\item ${inlineToLatex(item.content?.[0]?.content)}`)
        .join('\n');
      return `\\begin{itemize}\n${items}\n\\end{itemize}`;
    }
    case 'orderedList': {
      const items = (node.content ?? [])
        .map((item) => `\\item ${inlineToLatex(item.content?.[0]?.content)}`)
        .join('\n');
      return `\\begin{enumerate}\n${items}\n\\end{enumerate}`;
    }
    case 'codeBlock':
      return `\\begin{verbatim}\n${node.content?.[0]?.text ?? ''}\n\\end{verbatim}`;
    case 'hardBreak':
      return '\\\\';
    default:
      return inlineToLatex(node.content);
  }
}

export function tiptapToLatex(json: JSONContent): string {
  if (json.type === 'doc') {
    return (json.content ?? []).map(nodeToLatex).join('\n\n');
  }
  return nodeToLatex(json);
}
