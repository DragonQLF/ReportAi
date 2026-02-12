"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  FileText,
  Clock,
  ImageIcon,
  ArrowRight,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Report } from "@/lib/api";
import { formatRelativeTime } from "@/lib/utils";

const statusConfig: Record<
  Report["status"],
  { label: string; variant: "pending" | "processing" | "completed" | "failed"; icon: React.ElementType }
> = {
  pending: { label: "Pending", variant: "pending", icon: Clock },
  queued: { label: "Queued", variant: "pending", icon: Clock },
  reviewing: { label: "Reviewing", variant: "processing", icon: Loader2 },
  processing: { label: "Processing", variant: "processing", icon: Loader2 },
  writing: { label: "Writing", variant: "processing", icon: Loader2 },
  compiling: { label: "Compiling", variant: "processing", icon: Loader2 },
  completed: { label: "Completed", variant: "completed", icon: CheckCircle2 },
  failed: { label: "Failed", variant: "failed", icon: XCircle },
};

interface ReportCardProps {
  report: Report;
  index: number;
}

export function ReportCard({ report, index }: ReportCardProps) {
  const config = statusConfig[report.status] || {
    label: report.status,
    variant: "pending" as const,
    icon: AlertCircle,
  };
  const StatusIcon = config.icon;
  const isProcessing = ["reviewing", "processing", "writing", "compiling"].includes(
    report.status
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.4,
        delay: index * 0.05,
        ease: [0.25, 0.1, 0.25, 1],
      }}
    >
      <Link href={`/reports/new?id=${report.id}`}>
        <Card className="group relative overflow-hidden hover:border-primary/30 hover:shadow-md hover:shadow-primary/5 cursor-pointer transition-all duration-300">
          {/* Processing shimmer effect */}
          {isProcessing && (
            <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-primary/5 to-transparent" style={{ backgroundSize: "200% 100%" }} />
          )}

          <div className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-heading font-semibold text-sm truncate group-hover:text-primary transition-colors">
                      {report.title || "Untitled Report"}
                    </h3>
                    <p className="text-xs text-muted-foreground truncate">
                      {report.company || "No company"}
                      {report.role && ` \u00b7 ${report.role}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <ImageIcon className="h-3.5 w-3.5" />
                    <span>{report.screenshotCount || 0} screenshots</span>
                  </div>
                  <span className="text-border">·</span>
                  <span>{formatRelativeTime(report.createdAt)}</span>
                </div>
              </div>

              <div className="flex flex-col items-end gap-2 shrink-0">
                <Badge variant={config.variant} className="gap-1">
                  <StatusIcon
                    className={`h-3 w-3 ${isProcessing ? "animate-spin" : ""}`}
                  />
                  {config.label}
                </Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </div>
            </div>
          </div>
        </Card>
      </Link>
    </motion.div>
  );
}
