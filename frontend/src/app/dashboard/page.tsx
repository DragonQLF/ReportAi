"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  LayoutGrid,
  List,
  ImageIcon,
  CheckCircle2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Navbar } from "@/components/navbar";
import { ReportCard } from "@/components/report-card";
import { authClient } from "@/lib/auth-client";
import { api, type Report } from "@/lib/api";

export default function DashboardPage() {
  const router = useRouter();
  const { data: session, isPending: sessionLoading } = authClient.useSession();
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("list");

  useEffect(() => {
    if (!sessionLoading && !session?.user) {
      router.replace("/auth");
    }
  }, [session, sessionLoading, router]);

  const fetchReports = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await api.listReports();
      setReports(data.reports);
    } catch (err) {
      setError("Failed to load reports. Please try again.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session?.user) {
      fetchReports();
    }
  }, [session, fetchReports]);

  const filteredReports = reports.filter(
    (r) =>
      !search ||
      r.title?.toLowerCase().includes(search.toLowerCase()) ||
      r.company?.toLowerCase().includes(search.toLowerCase()) ||
      r.role?.toLowerCase().includes(search.toLowerCase())
  );

  // Compute stats
  const completedCount = reports.filter((r) => r.status === "completed").length;
  const totalScreenshots = reports.reduce(
    (sum, r) => sum + (r.screenshotCount || 0),
    0
  );

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();

  const firstName = session?.user?.name?.split(" ")[0];

  if (sessionLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session?.user) return null;

  return (
    <div className="relative min-h-screen bg-paper">
      <Navbar />

      <main className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 pt-24 pb-16">

        {/* ── Header ── */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="mb-8"
        >
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <p className="folio text-primary mb-2 border-b border-primary/40 pb-1 w-fit">
                {greeting}{firstName ? `, ${firstName}` : ""}
              </p>
              <h1 className="font-heading text-3xl font-bold tracking-tight mt-3">
                Your Reports
              </h1>
            </div>
            <Link href="/reports/new">
              <Button variant="glow" className="gap-2">
                <Plus className="h-4 w-4" />
                New Report
              </Button>
            </Link>
          </div>
        </motion.div>

        {/* ── Stats strip — only when there are reports ── */}
        {reports.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: 0.05 }}
            className="grid grid-cols-3 gap-3 mb-8"
          >
            {[
              { value: reports.length, label: "total reports", icon: FileText },
              { value: completedCount, label: "completed", icon: CheckCircle2 },
              { value: totalScreenshots, label: "screenshots processed", icon: ImageIcon },
            ].map((stat) => (
              <div
                key={stat.label}
                className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/50 px-4 py-3"
              >
                <stat.icon className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="text-lg font-semibold leading-none">{stat.value}</p>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{stat.label}</p>
                </div>
              </div>
            ))}
          </motion.div>
        )}

        {/* ── Filters ── */}
        {reports.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="flex items-center gap-3 mb-6"
          >
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title, company, or role..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center rounded-lg border border-border p-0.5">
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("list")}
              >
                <List className="h-4 w-4" />
              </Button>
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8"
                onClick={() => setViewMode("grid")}
              >
                <LayoutGrid className="h-4 w-4" />
              </Button>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-9 w-9"
              onClick={fetchReports}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </motion.div>
        )}

        {/* ── Content ── */}
        {loading && reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-sm text-muted-foreground">Loading your reports...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-24">
            <p className="text-sm text-destructive mb-4">{error}</p>
            <Button variant="outline" onClick={fetchReports}>Try Again</Button>
          </div>
        ) : filteredReports.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
            className="flex flex-col items-center justify-center py-24"
          >
            {search ? (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mb-4">
                  <Search className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium mb-1">No results for "{search}"</p>
                <p className="text-sm text-muted-foreground">
                  Try searching by title, company, or role
                </p>
              </>
            ) : (
              <>
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted mb-4">
                  <FileText className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium mb-1">No reports yet</p>
                <p className="text-sm text-muted-foreground mb-6 max-w-xs text-center">
                  Upload screenshots of your app and the AI will write the report for you.
                </p>
                <Link href="/reports/new">
                  <Button variant="glow" className="gap-2">
                    <Plus className="h-4 w-4" />
                    Create Your First Report
                  </Button>
                </Link>
              </>
            )}
          </motion.div>
        ) : (
          <div className={viewMode === "grid" ? "grid sm:grid-cols-2 gap-4" : "flex flex-col gap-3"}>
            <AnimatePresence>
              {filteredReports.map((report, index) => (
                <ReportCard key={report.id} report={report} index={index} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  );
}
