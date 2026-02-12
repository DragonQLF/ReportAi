"use client";

import { FileText, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";

export function PdfPlaceholder() {
  return (
    <div className="flex flex-col h-full bg-[#525659]">
      {/* Viewer toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-[#3c3c3c] shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="p-1 text-[#808080]"><ChevronLeft size={13} /></span>
          <span className="text-xs text-[#a0a0a0] tabular-nums select-none">— / —</span>
          <span className="p-1 text-[#808080]"><ChevronRight size={13} /></span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="p-1 text-[#808080]"><ZoomOut size={13} /></span>
          <span className="text-xs text-[#a0a0a0] tabular-nums select-none">100%</span>
          <span className="p-1 text-[#808080]"><ZoomIn size={13} /></span>
          <span className="p-1 text-[#808080] ml-1"><Maximize2 size={13} /></span>
        </div>
      </div>

      {/* Paper area */}
      <div className="flex-1 overflow-auto flex items-start justify-center py-8 px-6">
        <div
          className="bg-white shadow-2xl w-full shrink-0"
          style={{ maxWidth: 460, aspectRatio: "1 / 1.4142" }}
        >
          <div className="p-10 flex flex-col h-full">
            {/* Doc header */}
            <div className="flex items-start justify-between mb-5">
              <div className="space-y-1.5">
                <div className="h-2.5 w-28 rounded-sm bg-gray-200" />
                <div className="h-2 w-20 rounded-sm bg-gray-100" />
              </div>
              <div className="h-8 w-8 rounded bg-gray-100" />
            </div>

            {/* Title block */}
            <div className="flex flex-col items-center gap-2 mb-5">
              <div className="h-4 w-3/4 rounded bg-gray-300" />
              <div className="h-3 w-1/2 rounded bg-gray-200" />
              <div className="h-2.5 w-1/3 rounded bg-gray-100" />
            </div>

            <div className="border-t border-gray-200 mb-4" />

            {/* Body lines */}
            <div className="space-y-2">
              {[100, 96, 89, 100, 93, 85, 97].map((w, i) => (
                <div
                  key={i}
                  className="h-2 rounded-sm bg-gray-100"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>

            <div className="mt-4 mb-2">
              <div className="h-3 w-1/3 rounded bg-gray-200" />
            </div>

            <div className="space-y-2">
              {[92, 100, 88, 95, 80].map((w, i) => (
                <div
                  key={i}
                  className="h-2 rounded-sm bg-gray-100"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>

            {/* Center placeholder message */}
            <div className="flex-1 flex flex-col items-center justify-center gap-3 mt-4">
              <div className="w-12 h-12 rounded-full border-2 border-dashed border-gray-200 flex items-center justify-center">
                <FileText className="h-5 w-5 text-gray-300" />
              </div>
              <p className="text-[11px] text-gray-400 tracking-wide text-center">
                Your PDF will appear here
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
