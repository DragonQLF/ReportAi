"use client";

import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/core';
import React from 'react';

function FigureRefView({ node }: NodeViewProps) {
  const { index, feature } = node.attrs as { index: number; feature: string };
  return (
    <NodeViewWrapper as="span" style={{ display: 'inline-block' }}>
      <span
        data-figure-ref={index}
        contentEditable={false}
        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-primary/10 text-primary border border-primary/20 select-none cursor-default mx-0.5"
      >
        📷 {feature || `Figure ${index}`}
      </span>
    </NodeViewWrapper>
  );
}

export const FigureRefNode = Node.create({
  name: 'figureRef',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      index: { default: null },
      feature: { default: '' },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-figure-ref]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-figure-ref': node.attrs.index,
        'data-feature': node.attrs.feature,
      }),
      `📷 ${node.attrs.feature || `Figure ${node.attrs.index}`}`,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FigureRefView);
  },
});
