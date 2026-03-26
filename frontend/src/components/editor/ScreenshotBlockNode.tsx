"use client";

import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/core';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { GripVertical, X, Columns2, Unlink } from 'lucide-react';
import type { ScreenshotInfo } from '@/lib/latex-tiptap';

export const ScreenshotsContext = createContext<ScreenshotInfo[]>([]);

function ScreenshotBlockView({ node, editor, getPos, deleteNode }: NodeViewProps) {
  const screenshots = useContext(ScreenshotsContext);
  const [showPicker, setShowPicker] = useState(false);
  const pickerWrapRef = useRef<HTMLDivElement>(null);

  const { index, index2, feature, feature2 } = node.attrs as {
    index: number; index2: number | null; feature: string; feature2: string;
  };

  const s1 = screenshots.find((s) => s.index === index);
  const s2 = index2 != null ? screenshots.find((s) => s.index === index2) : null;
  const isPaired = index2 != null;

  // Close picker on outside click
  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerWrapRef.current && !pickerWrapRef.current.contains(e.target as globalThis.Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker]);

  // Remove \ref{} chips from prose for the given screenshot indices
  const removeRefChips = (indices: number[]) => {
    const { tr, doc } = editor.state;
    const toDelete: { from: number; to: number }[] = [];
    doc.descendants((n, pos) => {
      if (n.type.name === 'figureRef' && indices.includes(n.attrs.index as number)) {
        toDelete.push({ from: pos, to: pos + n.nodeSize });
      }
    });
    if (toDelete.length > 0) {
      const finalTr = toDelete.reverse().reduce((t, { from, to }) => t.delete(from, to), tr);
      editor.view.dispatch(finalTr);
    }
  };

  const handleDeleteAll = () => {
    const ownPos = getPos();
    if (ownPos === undefined) return;
    const indices = [index, index2].filter((i): i is number => i != null);
    const { tr, doc } = editor.state;
    // Collect figureRef chips AND the screenshotBlock itself, then delete all in one transaction
    const toDelete: { from: number; to: number }[] = [
      { from: ownPos, to: ownPos + node.nodeSize },
    ];
    doc.descendants((n, pos) => {
      if (n.type.name === 'figureRef' && indices.includes(n.attrs.index as number)) {
        toDelete.push({ from: pos, to: pos + n.nodeSize });
      }
    });
    const finalTr = toDelete
      .sort((a, b) => b.from - a.from)
      .reduce((t, { from, to }) => t.delete(from, to), tr);
    editor.view.dispatch(finalTr);
  };

  // Split a paired block into two separate single-image blocks
  const handleSplitPair = () => {
    const pos = getPos();
    if (pos === undefined || index2 == null) return;
    const { schema, tr } = editor.state;
    const single1 = schema.nodes.screenshotBlock.create({
      index, index2: null, feature, feature2: '',
    });
    const single2 = schema.nodes.screenshotBlock.create({
      index: index2, index2: null, feature: feature2, feature2: '',
    });
    editor.view.dispatch(tr.replaceWith(pos, pos + node.nodeSize, [single1, single2]));
  };

  const handlePairWith = (secondIndex: number) => {
    const pos = getPos();
    if (pos === undefined) return;
    const secondShot = screenshots.find((s) => s.index === secondIndex);

    let tr = editor.state.tr;

    // Collect standalone screenshotBlock nodes for secondIndex to remove
    const toRemove: { from: number; to: number }[] = [];
    editor.state.doc.descendants((n, nPos) => {
      if (
        n.type.name === 'screenshotBlock' &&
        n.attrs.index === secondIndex &&
        n.attrs.index2 == null &&
        nPos !== pos
      ) {
        toRemove.push({ from: nPos, to: nPos + n.nodeSize });
      }
    });

    // setNodeMarkup doesn't shift positions, so do it first
    tr = tr.setNodeMarkup(pos, undefined, {
      index, index2: secondIndex, feature, feature2: secondShot?.feature ?? '',
    });

    // Remove standalone blocks in reverse order (highest pos first)
    for (const { from, to } of toRemove.sort((a, b) => b.from - a.from)) {
      tr = tr.delete(from, to);
    }

    editor.view.dispatch(tr);
    setShowPicker(false);
  };

  const available = screenshots.filter((s) => s.index !== index && s.index !== index2);

  return (
    <NodeViewWrapper as="div" className="my-3 group/block">
      <div className="relative rounded-lg border border-border/50 bg-card/50 p-2 hover:border-border/80 transition-colors">

        {/* Drag handle — only element that initiates drag */}
        <div
          data-drag-handle
          contentEditable={false}
          className="absolute -left-5 top-1/2 -translate-y-1/2 opacity-0 group-hover/block:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-muted-foreground/40 hover:text-muted-foreground"
        >
          <GripVertical className="h-4 w-4" />
        </div>

        {/* Delete all button */}
        <button
          onMouseDown={(e) => { e.preventDefault(); handleDeleteAll(); }}
          contentEditable={false}
          className="absolute top-1.5 right-1.5 p-0.5 rounded opacity-0 group-hover/block:opacity-100 transition-opacity hover:bg-destructive/10 hover:text-destructive text-muted-foreground/40 z-10"
          title="Remove from section"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div contentEditable={false}>
          {isPaired ? (
            /* Side-by-side — single global X removes both; "Split" separates into two blocks */
            <div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <div className="rounded overflow-hidden bg-muted aspect-video">
                    {s1?.url
                      ? <img src={s1.url} alt={feature} className="w-full h-full object-cover" draggable={false} />
                      : <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No image</div>
                    }
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{feature}</p>
                </div>

                <div className="flex-1">
                  <div className="rounded overflow-hidden bg-muted aspect-video">
                    {s2?.url
                      ? <img src={s2.url} alt={feature2} className="w-full h-full object-cover" draggable={false} />
                      : <div className="w-full h-full flex items-center justify-center text-xs text-muted-foreground">No image</div>
                    }
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{feature2}</p>
                </div>
              </div>

              {/* Split pair */}
              <div className="mt-1.5 flex justify-end">
                <button
                  onMouseDown={(e) => { e.preventDefault(); handleSplitPair(); }}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  <Unlink className="h-3 w-3" />
                  Split pair
                </button>
              </div>
            </div>
          ) : (
            /* Single */
            <div>
              <div className="rounded overflow-hidden bg-muted">
                {s1?.url
                  ? <img src={s1.url} alt={feature} className="w-full max-h-56 object-contain" draggable={false} />
                  : <div className="w-full h-32 flex items-center justify-center text-xs text-muted-foreground">No image</div>
                }
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{feature}</p>
            </div>
          )}

          {/* Pair side-by-side control (single images only) */}
          {!isPaired && available.length > 0 && (
            <div className="mt-1.5 flex justify-end" ref={pickerWrapRef}>
              <button
                onMouseDown={(e) => { e.preventDefault(); setShowPicker((p) => !p); }}
                className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Columns2 className="h-3 w-3" />
                Pair side-by-side
              </button>
              {showPicker && (
                <div className="absolute right-2 bottom-full mb-1 bg-popover border border-border rounded-lg shadow-lg p-2 z-50 grid grid-cols-4 gap-1.5 max-w-[240px]">
                  {available.map((s) => (
                    <button
                      key={s.index}
                      onMouseDown={(e) => { e.preventDefault(); handlePairWith(s.index); }}
                      className="relative rounded overflow-hidden border border-border hover:border-primary transition-colors aspect-video bg-muted"
                      title={s.feature}
                    >
                      {s.url
                        ? <img src={s.url} alt={s.feature} className="w-full h-full object-cover" draggable={false} />
                        : <div className="w-full h-full flex items-center justify-center text-[8px] text-muted-foreground">?</div>
                      }
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

export const ScreenshotBlockNode = Node.create({
  name: 'screenshotBlock',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      index:    { default: null },
      index2:   { default: null },
      feature:  { default: '' },
      feature2: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-screenshot-block]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-screenshot-block': node.attrs.index,
        'data-index2': node.attrs.index2,
        'data-feature': node.attrs.feature,
        'data-feature2': node.attrs.feature2,
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ScreenshotBlockView);
  },
});
