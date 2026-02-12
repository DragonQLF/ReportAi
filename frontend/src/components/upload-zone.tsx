"use client";

import React, { useCallback, useState } from "react";
import { useDropzone, type FileRejection } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, X, Image as ImageIcon, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface UploadZoneProps {
  files: File[];
  onFilesChange: (files: File[]) => void;
  maxFiles?: number;
  disabled?: boolean;
}

export function UploadZone({
  files,
  onFilesChange,
  maxFiles = 50,
  disabled = false,
}: UploadZoneProps) {
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(
    (acceptedFiles: File[], rejectedFiles: FileRejection[]) => {
      setError(null);

      if (rejectedFiles.length > 0) {
        setError(
          `${rejectedFiles.length} file(s) rejected. Only images (PNG, JPG, WebP) and videos (MP4, MOV, WebM) are accepted.`
        );
      }

      const totalFiles = files.length + acceptedFiles.length;
      if (totalFiles > maxFiles) {
        setError(`Maximum ${maxFiles} files allowed.`);
        const remaining = maxFiles - files.length;
        if (remaining > 0) {
          onFilesChange([...files, ...acceptedFiles.slice(0, remaining)]);
        }
        return;
      }

      onFilesChange([...files, ...acceptedFiles]);
    },
    [files, maxFiles, onFilesChange]
  );

  const removeFile = (index: number) => {
    const newFiles = [...files];
    newFiles.splice(index, 1);
    onFilesChange(newFiles);
    setError(null);
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"],
      "video/mp4": [".mp4"],
      "video/quicktime": [".mov"],
      "video/webm": [".webm"],
    },
    maxFiles: maxFiles - files.length,
    disabled,
    multiple: true,
  });

  return (
    <div className="space-y-4">
      {/* Drop Zone */}
      <div
        {...getRootProps()}
        className={cn(
          "relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 transition-all duration-300 cursor-pointer",
          isDragActive
            ? "border-primary bg-primary/5 scale-[1.02]"
            : "border-border/60 hover:border-primary/40 hover:bg-muted/30",
          disabled && "opacity-50 cursor-not-allowed",
          files.length > 0 && "p-6"
        )}
      >
        <input {...getInputProps()} />

        {/* Scan line effect on drag */}
        {isDragActive && (
          <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
            <div className="absolute inset-x-0 h-px bg-gradient-to-r from-transparent via-primary to-transparent animate-scan-line" />
          </div>
        )}

        <div className="flex flex-col items-center gap-3 text-center">
          <div
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-xl transition-all duration-300",
              isDragActive
                ? "bg-primary/20 text-primary scale-110"
                : "bg-muted text-muted-foreground"
            )}
          >
            <Upload className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-medium">
              {isDragActive
                ? "Drop your screenshots here"
                : "Drag & drop screenshots here"}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              or click to browse · PNG, JPG, WebP, MP4, MOV · up to {maxFiles} files
            </p>
          </div>
          {files.length > 0 && (
            <p className="text-xs text-primary font-medium">
              {files.length} / {maxFiles} files selected
            </p>
          )}
        </div>
      </div>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            {error}
          </motion.div>
        )}
      </AnimatePresence>

      {/* File Grid */}
      <AnimatePresence mode="popLayout">
        {files.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3"
          >
            {files.map((file, index) => (
              <motion.div
                key={`${file.name}-${file.size}-${index}`}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ delay: index * 0.02 }}
                className="group relative aspect-square rounded-lg overflow-hidden border border-border/50 bg-muted"
              >
                <img
                  src={URL.createObjectURL(file)}
                  alt={file.name}
                  className="h-full w-full object-cover transition-transform group-hover:scale-105"
                />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors" />
                <Button
                  variant="destructive"
                  size="icon"
                  className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(index);
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/60 to-transparent p-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <p className="text-[10px] text-white truncate">{file.name}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
