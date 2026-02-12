"use client";

import React from "react";
import { motion } from "framer-motion";
import {
  Search,
  Eye,
  Brain,
  PenTool,
  FileCode,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import type { Report } from "@/lib/api";

interface PipelineStep {
  key: Report["status"];
  label: string;
  description: string;
  icon: React.ElementType;
}

const PIPELINE_STEPS: PipelineStep[] = [
  {
    key: "queued",
    label: "Queued",
    description: "Waiting in the generation queue",
    icon: Search,
  },
  {
    key: "reviewing",
    label: "Reviewing",
    description: "Checking image quality and deduplication",
    icon: Eye,
  },
  {
    key: "processing",
    label: "Analyzing",
    description: "AI vision pass on each screenshot",
    icon: Brain,
  },
  {
    key: "writing",
    label: "Writing",
    description: "Generating professional prose",
    icon: PenTool,
  },
  {
    key: "compiling",
    label: "Compiling",
    description: "Building LaTeX document into PDF",
    icon: FileCode,
  },
  {
    key: "completed",
    label: "Completed",
    description: "Your report is ready to download",
    icon: CheckCircle2,
  },
];

function getStepIndex(status: Report["status"]): number {
  const index = PIPELINE_STEPS.findIndex((s) => s.key === status);
  return index === -1 ? -1 : index;
}

function getProgressPercent(status: Report["status"]): number {
  if (status === "pending") return 0;
  if (status === "failed") return 0;
  const index = getStepIndex(status);
  if (index === -1) return 0;
  return Math.round(((index + 1) / PIPELINE_STEPS.length) * 100);
}

interface PipelineProgressProps {
  status: Report["status"];
  className?: string;
}

export function PipelineProgress({ status, className }: PipelineProgressProps) {
  const currentIndex = getStepIndex(status);
  const isFailed = status === "failed";
  const isCompleted = status === "completed";
  const progress = getProgressPercent(status);

  return (
    <div className={cn("space-y-6", className)}>
      {/* Progress Bar */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">
            {isFailed
              ? "Generation Failed"
              : isCompleted
              ? "Report Complete"
              : "Generating Report..."}
          </span>
          <span className="text-muted-foreground font-mono text-xs">
            {progress}%
          </span>
        </div>
        <Progress
          value={isFailed ? 100 : progress}
          className={cn(
            "h-2",
            isFailed && "[&>div]:bg-destructive"
          )}
        />
      </div>

      {/* Pipeline Steps */}
      <div className="relative">
        {/* Vertical connector line */}
        <div className="absolute left-5 top-5 bottom-5 w-px bg-border" />

        <div className="space-y-1">
          {PIPELINE_STEPS.map((step, index) => {
            const Icon = step.icon;
            const isActive = currentIndex === index && !isFailed;
            const isPast = currentIndex > index;
            const isCurrent = currentIndex === index;
            const isUpcoming = currentIndex < index;

            return (
              <motion.div
                key={step.key}
                initial={false}
                animate={{
                  opacity: isUpcoming && !isFailed ? 0.4 : 1,
                }}
                className="relative flex items-center gap-4 py-2.5"
              >
                {/* Step indicator */}
                <div
                  className={cn(
                    "relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-500",
                    isActive && "border-primary bg-primary/10",
                    isPast && "border-primary bg-primary",
                    isUpcoming && "border-border bg-background",
                    isFailed &&
                      isCurrent &&
                      "border-destructive bg-destructive/10"
                  )}
                >
                  {isPast ? (
                    <CheckCircle2 className="h-4 w-4 text-primary-foreground" />
                  ) : isActive ? (
                    <Loader2 className="h-4 w-4 text-primary animate-spin" />
                  ) : isFailed && isCurrent ? (
                    <XCircle className="h-4 w-4 text-destructive" />
                  ) : (
                    <Icon
                      className={cn(
                        "h-4 w-4",
                        isUpcoming
                          ? "text-muted-foreground"
                          : "text-foreground"
                      )}
                    />
                  )}
                </div>

                {/* Step content */}
                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      "text-sm font-medium transition-colors",
                      isActive && "text-primary",
                      isPast && "text-foreground",
                      isUpcoming && "text-muted-foreground",
                      isFailed && isCurrent && "text-destructive"
                    )}
                  >
                    {step.label}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {step.description}
                  </p>
                </div>

                {/* Active pulse */}
                {isActive && (
                  <motion.div
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    className="shrink-0"
                  >
                    <div className="h-2 w-2 rounded-full bg-primary animate-pulse-glow" />
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
