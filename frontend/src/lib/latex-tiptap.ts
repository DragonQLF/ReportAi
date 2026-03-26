/**
 * Bidirectional converter: LaTeX prose string ↔ TipTap JSON.
 *
 * LaTeX inline commands handled: \textbf{}, \textit{}, \texttt{}, \ref{fig:screenshot_N}, \\
 * Block environments handled:    \begin{itemize}, \begin{enumerate}, \begin{verbatim}, \begin{figure}
 * Screenshot blocks:             screenshotBlock node (single + side-by-side pairs)
 */
import type { JSONContent } from '@tiptap/core';

export interface ScreenshotInfo {
  index: number;
  feature: string;
  url: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

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
      if (depth === 1) continue;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) return { content, end: i };
    }
    if (depth > 0) content += ch;
  }
  return null;
}

// ─── LaTeX figure helpers (mirrors backend latex.ts) ─────────────────────

function escapeLatex(text: string): string {
  if (!text) return '';
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}]/g, (match) => `\\${match}`)
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

function figureLatex(index: number, feature: string): string {
  return (
    `\\begin{figure}[H]\n` +
    `  \\centering\n` +
    `  \\includegraphics[width=0.95\\textwidth]{screenshot_${index}}\n` +
    `  \\caption{${escapeLatex(feature)}}\n` +
    `  \\label{fig:screenshot_${index}}\n` +
    `\\end{figure}`
  );
}

function figurePairLatex(idx1: number, idx2: number, f1: string, f2: string): string {
  return (
    `\\begin{figure}[H]\n` +
    `  \\centering\n` +
    `  \\begin{minipage}{0.48\\textwidth}\n` +
    `    \\centering\n` +
    `    \\includegraphics[width=\\linewidth]{screenshot_${idx1}}\n` +
    `    \\caption{${escapeLatex(f1)}}\n` +
    `    \\label{fig:screenshot_${idx1}}\n` +
    `  \\end{minipage}\n` +
    `  \\hfill\n` +
    `  \\begin{minipage}{0.48\\textwidth}\n` +
    `    \\centering\n` +
    `    \\includegraphics[width=\\linewidth]{screenshot_${idx2}}\n` +
    `    \\caption{${escapeLatex(f2)}}\n` +
    `    \\label{fig:screenshot_${idx2}}\n` +
    `  \\end{minipage}\n` +
    `\\end{figure}`
  );
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
      const braceIdx = i + 4;
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

    // Text before the next \begin — split into paragraphs
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

    const envNameResult = extractBraceContent(content, beginIdx + 6);
    if (!envNameResult) { pos = beginIdx + 7; continue; }

    const envName = envNameResult.content;
    const endTag = `\\end{${envName}}`;
    const bodyStart = envNameResult.end + 1;
    const bodyEnd = content.indexOf(endTag, bodyStart);
    if (bodyEnd === -1) { pos = beginIdx + 7; continue; }

    const body = content.slice(bodyStart, bodyEnd).trim();
    pos = bodyEnd + endTag.length;

    if (envName === 'figure') {
      // Extract all unique screenshot indices from the figure body
      const indices = [
        ...new Set(
          [...body.matchAll(/screenshot_(\d+)/g)].map((m) => parseInt(m[1], 10)),
        ),
      ];
      if (indices.length >= 2) {
        const [idx1, idx2] = indices;
        nodes.push({
          type: 'screenshotBlock',
          attrs: {
            index: idx1,
            index2: idx2,
            feature: screenshotMap.get(idx1) ?? '',
            feature2: screenshotMap.get(idx2) ?? '',
          },
        });
      } else if (indices.length === 1) {
        const [idx] = indices;
        nodes.push({
          type: 'screenshotBlock',
          attrs: {
            index: idx,
            index2: null,
            feature: screenshotMap.get(idx) ?? '',
            feature2: '',
          },
        });
      }
    } else if (envName === 'itemize' || envName === 'enumerate') {
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

/**
 * Convert a LaTeX content string to TipTap JSON.
 *
 * Two modes:
 * - New mode: content contains \begin{figure} blocks → parse them inline at position.
 * - Old mode: content has no inline figures but screenshotIndices/screenshotPairs
 *   are provided → append screenshotBlock nodes at the end (backward compat).
 */
export function latexToTiptap(
  content: string,
  screenshots: ScreenshotInfo[],
  screenshotIndices?: number[],
  screenshotPairs?: [number, number][],
): JSONContent {
  const screenshotMap = new Map(screenshots.map((s) => [s.index, s.feature]));
  const blocks = parseBlocks(content, screenshotMap);

  // Old-mode: no inline figures in content, append blocks from screenshotIndices
  const hasInlineFigures = content.includes('\\begin{figure}');
  if (!hasInlineFigures && screenshotIndices && screenshotIndices.length > 0) {
    const pairs = screenshotPairs ?? [];
    const pairedSeconds = new Set(pairs.map(([, b]) => b));
    const pairMap = new Map(pairs.map(([a, b]) => [a, b]));

    for (const idx of screenshotIndices) {
      if (pairedSeconds.has(idx)) continue;
      const partner = pairMap.get(idx);
      if (partner != null) {
        blocks.push({
          type: 'screenshotBlock',
          attrs: {
            index: idx,
            index2: partner,
            feature: screenshotMap.get(idx) ?? '',
            feature2: screenshotMap.get(partner) ?? '',
          },
        });
      } else {
        blocks.push({
          type: 'screenshotBlock',
          attrs: {
            index: idx,
            index2: null,
            feature: screenshotMap.get(idx) ?? '',
            feature2: '',
          },
        });
      }
    }
  }

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
    case 'screenshotBlock': {
      const { index, index2, feature, feature2 } = node.attrs ?? {};
      if (index == null) return '';
      if (index2 != null) {
        return figurePairLatex(index, index2, feature ?? '', feature2 ?? '');
      }
      return figureLatex(index, feature ?? '');
    }
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

// ─── util: derive screenshotIndices + screenshotPairs from TipTap JSON ───────

export function deriveScreenshotMeta(json: JSONContent): {
  screenshotIndices: number[];
  screenshotPairs: [number, number][];
} {
  const indices: number[] = [];
  const pairs: [number, number][] = [];

  function traverse(node: JSONContent) {
    if (node.type === 'screenshotBlock') {
      const { index, index2 } = node.attrs ?? {};
      if (index != null) {
        indices.push(index as number);
        if (index2 != null) {
          indices.push(index2 as number);
          pairs.push([index as number, index2 as number]);
        }
      }
    }
    node.content?.forEach(traverse);
  }
  traverse(json);

  return { screenshotIndices: [...new Set(indices)], screenshotPairs: pairs };
}
