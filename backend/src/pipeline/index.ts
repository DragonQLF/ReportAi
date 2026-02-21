import { prisma } from '../utils/prisma';
import { logger } from '../utils/logger';
import { PipelineError } from '../utils/errors';
import { redis } from '../queue/connection';
import { downloadFromR2 } from '../storage/screenshot-storage.service';
import { reviewScreenshots } from './reviewer';
import { analyzeScreenshots } from './vision';
import { clusterScreenshots } from './cluster';
import { mapDocumentToSections } from './docmapper';
import { writeSections } from './writer';
import { generateLatex } from './latex';
import type { PipelineContext } from './schemas';

type ReportStatus = 'processing' | 'reviewing' | 'writing' | 'compiling' | 'completed' | 'failed';

/**
 * Run the full report generation pipeline.
 * Updates the report status in the database at each stage.
 *
 * Pipeline stages:
 *   1. reviewing  — blur detection, dedup, frame count validation
 *   2. processing — AI vision analysis of each screenshot
 *   3. writing    — section clustering, prose generation
 *   4. compiling  — LaTeX template fill + PDF compilation
 *   5. completed  — final output URLs saved
 */
export async function runPipeline(reportId: string): Promise<void> {
  logger.info('Pipeline started', { reportId });

  try {
    // Load report with screenshots
    const report = await prisma.report.findUnique({
      where: { id: reportId },
      include: {
        screenshots: {
          where: { excluded: false },
          orderBy: { index: 'asc' },
        },
      },
    });

    if (!report) {
      throw new PipelineError('init', 'Report not found');
    }

    type ContextDoc = { name: string; url: string; text: string };
    const contextDocuments: ContextDoc[] = Array.isArray(report.contextDocuments)
      ? (report.contextDocuments as ContextDoc[])
      : [];

    const context: PipelineContext = {
      reportId: report.id,
      title: report.title ?? undefined,
      company: report.company ?? undefined,
      role: report.role ?? undefined,
      dates: report.dates ?? undefined,
      techStack: report.techStack,
      description: report.description ?? undefined,
      language: report.language,
      style: report.style,
      font: report.font,
      customFields: (report.customFields as Record<string, { label: string; value: string }>) ?? undefined,
    };

    // ===== Stage 1: Review screenshots =====
    await updateStage(reportId, 'reviewing', 'reviewing');

    // Download screenshot buffers from R2
    const screenshotBuffers = await Promise.all(
      report.screenshots.map(async (s) => ({
        id: s.id,
        index: s.index,
        imageBuffer: await downloadFromR2(s.url),
      })),
    );

    const reviewOutput = await reviewScreenshots({ screenshots: screenshotBuffers });

    // Update DB: mark excluded screenshots and store blur scores
    await Promise.all(
      reviewOutput.results.map(async (result) => {
        await prisma.screenshot.update({
          where: { id: result.screenshotId },
          data: {
            excluded: !result.keep,
            blurScore: result.blurScore,
          },
        });
      }),
    );

    await prisma.report.update({
      where: { id: reportId },
      data: { frameCount: reviewOutput.keptCount },
    });

    const keptScreenshots = screenshotBuffers.filter((s) =>
      reviewOutput.results.find((r) => r.screenshotId === s.id && r.keep),
    );

    // ===== Stage 2: Vision analysis =====
    await updateStage(reportId, 'processing', 'processing');

    const visionOutput = await analyzeScreenshots({
      screenshots: keptScreenshots.map((s) => ({
        index: s.index,
        imageBuffer: s.imageBuffer,
      })),
      context: {
        projectName: context.title ?? 'Untitled Project',
        description: context.description ?? '',
        techStack: context.techStack,
        language: context.language ?? 'en',
        customFields: context.customFields,
      },
    });

    // Update screenshots with AI-generated descriptions
    await Promise.all(
      visionOutput.screenshots.map(async (analysis) => {
        const screenshot = report.screenshots.find((s) => s.index === analysis.index);
        if (screenshot) {
          await prisma.screenshot.update({
            where: { id: screenshot.id },
            data: {
              feature: analysis.feature,
              description: analysis.description,
            },
          });
        }
      }),
    );

    // ===== Stage 3: Clustering + Writing =====
    await updateStage(reportId, 'writing', 'writing');

    const clusterOutput = await clusterScreenshots({
      screenshots: visionOutput.screenshots,
      context: {
        projectName: context.title ?? 'Untitled Project',
        description: context.description ?? '',
        role: context.role ?? '',
        style: context.style,
        language: context.language,
        customFields: context.customFields,
      },
    });

    // Update report with suggested title and section count
    await prisma.report.update({
      where: { id: reportId },
      data: {
        title: report.title ?? clusterOutput.reportTitle,
        sectionCount: clusterOutput.sections.length,
      },
    });

    // Update screenshots with assigned sections
    await Promise.all(
      clusterOutput.sections.flatMap((section) =>
        section.screenshotIndices.map(async (idx) => {
          const screenshot = report.screenshots.find((s) => s.index === idx);
          if (screenshot) {
            await prisma.screenshot.update({
              where: { id: screenshot.id },
              data: { section: section.name },
            });
          }
        }),
      ),
    );

    // ===== Optional: Document mapping pass =====
    // If the user uploaded reference documents (PDFs, text files), map each
    // document's relevant content to each section so the writer gets focused
    // context rather than the full document dumped into every section prompt.
    let documentContext: Record<string, string> | undefined;
    if (contextDocuments.length > 0) {
      const combinedText = contextDocuments.map((d) => `[${d.name}]\n${d.text}`).join('\n\n---\n\n');
      documentContext = await mapDocumentToSections({
        sections: clusterOutput.sections.map((s) => ({ name: s.name, description: s.description })),
        documentText: combinedText,
        language: context.language,
      });
    }

    const writerOutput = await writeSections({
      sections: clusterOutput.sections,
      screenshots: visionOutput.screenshots,
      context: {
        projectName: context.title ?? clusterOutput.reportTitle,
        company: context.company ?? '',
        role: context.role ?? '',
        dates: context.dates ?? '',
        description: context.description ?? '',
        techStack: context.techStack,
        style: context.style,
        language: context.language,
        customFields: context.customFields,
        documentContext,
      },
    });

    // ===== Stage 4: LaTeX compilation =====
    await updateStage(reportId, 'compiling', 'compiling');

    const keptDbScreenshots = await prisma.screenshot.findMany({
      where: { reportId, excluded: false },
      orderBy: { index: 'asc' },
    });

    const latexOutput = await generateLatex({
      writerOutput,
      sections: clusterOutput.sections,
      screenshots: keptDbScreenshots.map((s) => ({
        index: s.index,
        url: s.url,
        feature: s.feature ?? '',
        description: s.description ?? '',
      })),
      imageBuffers: keptScreenshots.map((s) => ({ index: s.index, buffer: s.imageBuffer })),
      context: {
        reportId,
        title: report.title ?? clusterOutput.reportTitle ?? 'Untitled Report',
        company: context.company ?? '',
        role: context.role ?? '',
        dates: context.dates ?? '',
        language: context.language,
        style: context.style,
        font: context.font,
        customFields: context.customFields,
      },
    });

    // ===== Stage 5: Mark completed =====
    // Build structured sectionContent from writer + cluster output so edits
    // can target prose sections directly without fetching and round-tripping the full .tex
    const sectionContent = {
      introduction: writerOutput.introduction,
      sections: writerOutput.sections.map((sc) => {
        const cluster = clusterOutput.sections.find((s) => s.name === sc.sectionName);
        return {
          sectionName: sc.sectionName,
          content: sc.content,
          screenshotIndices: cluster?.screenshotIndices ?? [],
          screenshotPairs: cluster?.screenshotPairs ?? [],
        };
      }),
      conclusion: writerOutput.conclusion,
    };

    const completed = await prisma.report.update({
      where: { id: reportId },
      data: {
        status: 'completed',
        currentStage: 'completed',
        pdfUrl: latexOutput.pdfUrl,
        texUrl: latexOutput.texUrl,
        sectionContent,
      },
      select: { status: true, currentStage: true, frameCount: true, sectionCount: true, errorMessage: true, pdfUrl: true, texUrl: true },
    });

    await redis.publish(`job:${reportId}`, JSON.stringify(completed));
    logger.info('Pipeline completed successfully', { reportId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown pipeline error';
    const stage = error instanceof PipelineError ? error.stage : 'unknown';

    logger.error('Pipeline failed', { reportId, stage, message });

    const failed = await prisma.report.update({
      where: { id: reportId },
      data: {
        status: 'failed',
        currentStage: stage,
        errorMessage: message,
      },
      select: { status: true, currentStage: true, frameCount: true, sectionCount: true, errorMessage: true, pdfUrl: true, texUrl: true },
    });

    await redis.publish(`job:${reportId}`, JSON.stringify(failed));
  }
}

/** Helper to update report status and current stage atomically, then publish via Redis pub/sub. */
async function updateStage(
  reportId: string,
  status: ReportStatus,
  stage: string,
): Promise<void> {
  const updated = await prisma.report.update({
    where: { id: reportId },
    data: { status, currentStage: stage },
    select: { status: true, currentStage: true, frameCount: true, sectionCount: true, errorMessage: true, pdfUrl: true, texUrl: true },
  });

  logger.info('Pipeline stage updated', { reportId, stage });
  await redis.publish(`job:${reportId}`, JSON.stringify(updated));
}
