"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/navbar";
import { authClient } from "@/lib/auth-client";

const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.6 } },
};

const riseIn = {
  initial: { opacity: 0, y: 28 },
  animate: { opacity: 1, y: 0 },
};

const stagger = {
  animate: { transition: { staggerChildren: 0.1 } },
};

export default function LandingPage() {
  const { data: session } = authClient.useSession();

  return (
    <div className="relative min-h-screen overflow-hidden bg-paper">
      <Navbar />

      {/* Background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-background" />
        <div className="absolute inset-0 bg-graph-pattern mask-fade-b opacity-60 dark:opacity-30" />
        {/* Soft warm glow — much subtler than before */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[700px] h-[400px] bg-primary/5 dark:bg-primary/4 rounded-full blur-[120px]" />
      </div>

      {/* ── Hero ── */}
      <section className="relative pt-28 pb-10 sm:pt-36 sm:pb-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="initial"
            animate="animate"
            variants={stagger}
            className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center"
          >
            {/* Left: headline + CTAs */}
            <div className="lg:max-w-xl">
              {/* Eyebrow */}
              <motion.div variants={riseIn} transition={{ duration: 0.5 }}>
                <span className="folio inline-block mb-6 pb-1 border-b border-primary/40 text-primary">
                  AI Report Generator
                </span>
              </motion.div>

              <motion.h1
                variants={riseIn}
                transition={{ duration: 0.6 }}
                className="font-heading text-5xl sm:text-6xl lg:text-[5rem] font-bold tracking-tight leading-[1.0]"
              >
                You built it.
                <br />
                <span className="text-primary italic">We write it.</span>
              </motion.h1>

              <motion.p
                variants={riseIn}
                transition={{ duration: 0.5 }}
                className="mt-7 text-[1.0625rem] text-muted-foreground leading-[1.75] max-w-md"
              >
                Upload screenshots of your app. AI reads what&apos;s on
                screen and writes the professional report — compiled to PDF,
                ready to submit.
              </motion.p>

              <motion.div
                variants={riseIn}
                transition={{ duration: 0.4 }}
                className="mt-10 flex flex-col sm:flex-row items-start gap-3"
              >
                <Link href={session?.user ? "/dashboard" : "/auth"}>
                  <Button size="xl" variant="glow" className="gap-2.5 text-base font-medium group">
                    Generate My Report
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                </Link>
                <a href="#how-it-works">
                  <Button size="xl" variant="outline" className="text-base font-medium">
                    See How It Works
                  </Button>
                </a>
              </motion.div>

              <motion.p
                variants={riseIn}
                transition={{ duration: 0.4 }}
                className="mt-4 text-sm text-muted-foreground/70"
              >
                Free tier · No credit card
              </motion.p>
            </div>

            {/* Right: document preview */}
            <motion.div
              variants={fadeIn}
              transition={{ duration: 0.9, delay: 0.2 }}
              className="relative hidden lg:block"
            >
              {/* Subtle glow behind card */}
              <div className="absolute -inset-8 bg-primary/6 rounded-3xl blur-[60px] -z-10" />

              {/* Document card — looks like a real report, not a macOS window */}
              <div className="rounded-lg border border-border/60 bg-card shadow-2xl overflow-hidden">
                {/* Document meta bar */}
                <div className="flex items-center justify-between px-5 py-2.5 border-b border-border/50 bg-muted/30">
                  <span className="folio">Internship_Report_2024.pdf</span>
                  <span className="folio">Page 1 / 12</span>
                </div>

                {/* Document page body */}
                <div className="p-8 space-y-5">
                  {/* Title block */}
                  <div className="text-center space-y-2 pb-5 border-b border-border/40">
                    <p className="folio text-primary tracking-[0.3em]">
                      Internship Report — Software Engineering
                    </p>
                    <div className="h-4 w-3/5 mx-auto rounded-sm bg-foreground/18 mt-3" />
                    <div className="h-3 w-2/5 mx-auto rounded-sm bg-foreground/10 mt-1.5" />
                    <div className="h-2.5 w-1/3 mx-auto rounded-sm bg-foreground/[0.07] mt-1" />
                  </div>

                  {/* Section 1 */}
                  <div className="space-y-2.5">
                    <div className="flex items-baseline gap-2.5">
                      <span className="font-mono text-[9px] text-primary font-medium tracking-wider">1.</span>
                      <div className="h-2.5 w-32 rounded-sm bg-foreground/22" />
                    </div>
                    <div className="pl-5 space-y-1.5">
                      <div className="h-2 w-full rounded-sm bg-foreground/[0.07]" />
                      <div className="h-2 w-[97%] rounded-sm bg-foreground/[0.07]" />
                      <div className="h-2 w-[84%] rounded-sm bg-foreground/[0.07]" />
                      <div className="h-2 w-[91%] rounded-sm bg-foreground/[0.07]" />
                    </div>
                  </div>

                  {/* Section 2 */}
                  <div className="space-y-2.5">
                    <div className="flex items-baseline gap-2.5">
                      <span className="font-mono text-[9px] text-primary font-medium tracking-wider">2.</span>
                      <div className="h-2.5 w-44 rounded-sm bg-foreground/22" />
                    </div>
                    <div className="pl-5 space-y-1.5">
                      <div className="h-2 w-full rounded-sm bg-foreground/[0.07]" />
                      <div className="h-2 w-[88%] rounded-sm bg-foreground/[0.07]" />
                      <div className="h-2 w-[76%] rounded-sm bg-foreground/[0.07]" />
                    </div>
                  </div>

                  {/* Figure row */}
                  <div className="flex gap-2.5 pt-1">
                    {[0, 1, 2].map((i) => (
                      <div
                        key={i}
                        className="h-14 flex-1 rounded bg-muted/70 border border-border/30"
                      />
                    ))}
                  </div>
                  <div className="text-center">
                    <div className="h-1.5 w-32 mx-auto rounded-sm bg-foreground/[0.05]" />
                  </div>
                </div>
              </div>

              {/* Floating status badge */}
              <motion.div
                className="absolute -bottom-4 -right-4 flex items-center gap-2 rounded-full border border-border/60 bg-card px-3.5 py-2 shadow-lg"
                initial={{ opacity: 0, scale: 0.88 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 1.0, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              >
                <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-xs font-medium">PDF ready · 12 sections</span>
              </motion.div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ── How It Works ── */}
      <section id="how-it-works" className="relative py-16 sm:py-24 border-t border-border/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, margin: "-80px" }}
            variants={stagger}
            className="mb-16"
          >
            <motion.div variants={riseIn} transition={{ duration: 0.5 }}>
              <span className="folio text-primary border-b border-primary/40 pb-1">
                The Process
              </span>
              <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mt-5">
                Three steps.
                <br />
                <span className="italic font-normal text-muted-foreground">One report.</span>
              </h2>
            </motion.div>
          </motion.div>

          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, margin: "-50px" }}
            variants={stagger}
            className="space-y-0 divide-y divide-border/40"
          >
            {[
              {
                step: "01",
                title: "Upload your screenshots",
                description:
                  "Drag & drop up to 50 screenshots. The AI reviewer filters blurry frames, removes duplicates, and confirms there's enough coverage to write from.",
              },
              {
                step: "02",
                title: "AI reads what you built",
                description:
                  "Gemini Vision describes each screen. The writing model groups them into logical sections — Authentication, Dashboard, Data Management — and writes 2–3 paragraphs per section.",
              },
              {
                step: "03",
                title: "Download your PDF",
                description:
                  "A LaTeX-compiled PDF arrives in minutes. Clean, no watermark, ready to submit. The .tex source is included if you want to tweak the formatting.",
              },
            ].map((item) => (
              <motion.div
                key={item.step}
                variants={riseIn}
                transition={{ duration: 0.5 }}
                className="grid sm:grid-cols-[140px_1fr] gap-4 sm:gap-16 py-10 sm:py-14 items-start group"
              >
                {/* Step number — large, ghost, editorial */}
                <div
                  className="font-heading text-[6rem] sm:text-[8rem] font-bold leading-none
                    text-foreground/[0.05] group-hover:text-foreground/[0.09] transition-colors duration-700
                    select-none sm:text-right"
                >
                  {item.step}
                </div>

                <div className="pt-1 sm:pt-3">
                  <h3 className="font-heading text-xl sm:text-2xl font-semibold tracking-tight mb-3">
                    {item.title}
                  </h3>
                  <p className="text-muted-foreground leading-[1.8] max-w-lg text-[0.9375rem]">
                    {item.description}
                  </p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Pricing ── */}
      <section id="pricing" className="relative py-16 sm:py-24 border-t border-border/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, margin: "-80px" }}
            variants={stagger}
            className="mb-16"
          >
            <motion.div variants={riseIn} transition={{ duration: 0.5 }}>
              <span className="folio text-primary border-b border-primary/40 pb-1">
                Pricing
              </span>
              <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mt-5">
                Pay for the output.
                <br />
                <span className="italic font-normal text-muted-foreground">Not the process.</span>
              </h2>
            </motion.div>
          </motion.div>

          <motion.div
            initial="initial"
            whileInView="animate"
            viewport={{ once: true, margin: "-50px" }}
            variants={stagger}
            className="grid md:grid-cols-3 gap-5 max-w-5xl"
          >
            {[
              {
                name: "Free",
                price: "$0",
                period: "",
                description: "See what the AI makes of your screenshots",
                features: [
                  "1 report",
                  "Up to 10 screenshots",
                  "Watermarked PDF",
                  "Standard queue",
                ],
                cta: "Try Free",
                popular: false,
              },
              {
                name: "Single Report",
                price: "$9",
                period: "one-time",
                description: "One clean, submittable report",
                features: [
                  "1 report, no watermark",
                  "Up to 50 screenshots",
                  "PDF + .tex source",
                  "Priority processing",
                ],
                cta: "Get the Report",
                popular: true,
              },
              {
                name: "Unlimited",
                price: "$15",
                period: "/month",
                description: "For ongoing documentation needs",
                features: [
                  "Unlimited reports",
                  "Up to 50 screenshots each",
                  "PDF + .tex source",
                  "University templates",
                  "Priority queue",
                  "Email support",
                ],
                cta: "Subscribe",
                popular: false,
              },
            ].map((plan) => (
              <motion.div
                key={plan.name}
                variants={riseIn}
                transition={{ duration: 0.4 }}
                className="relative"
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-6 z-10">
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
                      <Sparkles className="h-3 w-3" />
                      Most popular
                    </div>
                  </div>
                )}

                <div
                  className={`relative h-full flex flex-col rounded-lg border p-6 sm:p-7 transition-all duration-300 ${
                    plan.popular
                      ? "border-primary/50 bg-primary/5 shadow-lg shadow-primary/10"
                      : "border-border/50 bg-card/60 hover:border-border hover:bg-card"
                  }`}
                >
                  <div className="mb-5">
                    <p className="folio text-primary mb-1">{plan.name}</p>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {plan.description}
                    </p>
                  </div>

                  <div className="mb-6 pb-5 border-b border-border/40">
                    <span className="font-heading text-4xl font-bold tracking-tight">
                      {plan.price}
                    </span>
                    {plan.period && (
                      <span className="text-sm text-muted-foreground ml-1.5">
                        {plan.period}
                      </span>
                    )}
                  </div>

                  <ul className="space-y-2.5 mb-8 flex-1">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2.5 text-sm">
                        <Check className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
                        <span className="text-muted-foreground">{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <Link href={session?.user ? "/dashboard" : "/auth"}>
                    <Button
                      variant={plan.popular ? "glow" : "outline"}
                      className="w-full font-medium"
                      size="lg"
                    >
                      {plan.cta}
                    </Button>
                  </Link>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* ── Final CTA ── */}
      <section className="relative py-16 sm:py-24 border-t border-border/40">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="relative rounded-lg border border-border/50 bg-card/60 p-10 sm:p-16 overflow-hidden"
          >
            {/* Subtle graph pattern inside card */}
            <div className="absolute inset-0 bg-graph-pattern opacity-40" />
            {/* Warm glow from primary corner */}
            <div className="absolute -top-16 -right-16 w-64 h-64 bg-primary/8 rounded-full blur-3xl" />

            <div className="relative max-w-2xl">
              <span className="folio text-primary border-b border-primary/40 pb-1 block mb-6 w-fit">
                Ready to start
              </span>
              <h2 className="font-heading text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">
                Stop writing reports.
                <br />
                <span className="italic font-normal text-muted-foreground">
                  Start submitting them.
                </span>
              </h2>
              <p className="mt-5 text-muted-foreground max-w-md leading-[1.8] text-[0.9375rem]">
                Your app is already built. The documentation should take minutes,
                not days. Upload your screenshots and see what comes out.
              </p>
              <div className="mt-8">
                <Link href={session?.user ? "/dashboard" : "/auth"}>
                  <Button size="xl" variant="glow" className="gap-2.5 font-medium group">
                    Generate My Report
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                </Link>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-border/40 py-10">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
            <div>
              <Link href="/" className="font-heading text-lg font-bold tracking-tight">
                Report<span className="text-primary italic">AI</span>
              </Link>
              <p className="text-xs text-muted-foreground/50 mt-1.5">
                MIT licensed core · Hosted product by ReportAI
              </p>
            </div>
            <div className="flex gap-6 text-sm text-muted-foreground/60">
              <Link href="/privacy" className="hover:text-foreground transition-colors">
                Privacy
              </Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">
                Terms
              </Link>
              <a href="https://github.com" className="hover:text-foreground transition-colors">
                GitHub
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
