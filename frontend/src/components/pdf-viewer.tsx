"use client";

import React, { useState, useCallback } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  url: string;
  className?: string;
}

export function PdfViewer({ url, className }: PdfViewerProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [scale, setScale] = useState(1.0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setLoading(false);
  }, []);

  const onDocumentLoadError = useCallback(() => {
    setError(true);
    setLoading(false);
  }, []);

  const zoomIn = () => setScale((s) => Math.min(s + 0.2, 2.5));
  const zoomOut = () => setScale((s) => Math.max(s - 0.2, 0.5));

  if (error) {
    return (
      <div className={cn("flex items-center justify-center h-48 text-sm text-muted-foreground", className)}>
        Failed to load PDF preview.{" "}
        <a href={url} target="_blank" rel="noopener noreferrer" className="ml-1 text-primary underline">
          Open directly
        </a>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col h-full", className)}>
      {/* Toolbar */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-border/50 bg-muted/30">
        <span className="text-xs text-muted-foreground tabular-nums">
          {loading ? "Loading..." : `${numPages} page${numPages !== 1 ? "s" : ""}`}
        </span>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomOut} disabled={scale <= 0.5}>
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="text-xs text-muted-foreground tabular-nums min-w-[44px] text-center">
            {Math.round(scale * 100)}%
          </span>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={zoomIn} disabled={scale >= 2.5}>
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <a href={url} target="_blank" rel="noopener noreferrer">
            <Button variant="ghost" size="icon" className="h-7 w-7 ml-1">
              <Maximize2 className="h-3.5 w-3.5" />
            </Button>
          </a>
        </div>
      </div>

      {/* Scrollable pages */}
      <div className="flex-1 overflow-y-auto bg-muted/20 flex flex-col items-center py-4 gap-4 scrollbar-thin">
        {loading && (
          <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
            Loading PDF...
          </div>
        )}
        <Document
          file={url}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={null}
        >
          {Array.from({ length: numPages }, (_, i) => (
            <div key={i + 1} className="flex flex-col items-center gap-4">
              <Page
                pageNumber={i + 1}
                scale={scale}
                renderTextLayer={true}
                renderAnnotationLayer={true}
                className="shadow-lg"
              />
              {i + 1 < numPages && (
                <div className="flex items-center gap-3 w-full max-w-xs opacity-30">
                  <div className="flex-1 h-px bg-border" />
                  <span className="text-[10px] text-muted-foreground font-mono">{i + 2}</span>
                  <div className="flex-1 h-px bg-border" />
                </div>
              )}
            </div>
          ))}
        </Document>
      </div>
    </div>
  );
}
