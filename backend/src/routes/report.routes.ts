import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';
import { reportQueue } from '../queue/report.queue';
import { createSubscriber } from '../queue/connection';
import { deleteStorageFile } from '../storage/screenshot-storage.service';
import { editDocument as applyDocumentEdit } from '../pipeline/editor';

const router = Router();

/** Extract route param as string (Express 5 types params as string | string[]) */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// --- Validation schemas ---

const customFieldValueSchema = z.object({ label: z.string(), value: z.string() });

const createReportSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  company: z.string().min(1).max(200).optional(),
  role: z.string().min(1).max(200).optional(),
  dates: z.string().max(100).optional(),
  techStack: z.array(z.string()).default([]),
  description: z.string().max(5000).optional(),
  language: z.enum(['en','pt','pt-br','es','fr','de','it','nl','pl','ru','el','cs','sk','hu','ro','tr','sv','no','da','fi']).default('en'),
  style: z.enum(['academic', 'professional', 'technical']).default('academic'),
  font: z.enum(['default', 'garamond', 'times', 'palatino', 'helvetica', 'charter', 'calibri', 'arial']).default('default'),
  customFields: z.record(customFieldValueSchema).default({}),
});

const updateReportSchema = createReportSchema.partial();

// --- Routes ---

/** POST /api/reports — Create a new report */
router.post(
  '/',
  requireAuth,
  validate(createReportSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await prisma.report.create({
        data: {
          ...req.body,
          userId: req.user!.id,
        },
      });

      logger.info('Report created', { reportId: report.id, userId: req.user!.id });

      res.status(201).json({
        success: true,
        data: { report },
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/reports — List user's reports (paginated) */
router.get(
  '/',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = req.user!.id;
      const page  = Math.max(1, parseInt((req.query.page  as string) || '1'));
      const limit = Math.min(100, Math.max(1, parseInt((req.query.limit as string) || '20')));

      const [reports, total] = await Promise.all([
        prisma.report.findMany({
          where: { userId },
          skip: (page - 1) * limit,
          take: limit,
          orderBy: { createdAt: 'desc' },
          include: {
            _count: { select: { screenshots: true } },
          },
        }),
        prisma.report.count({ where: { userId } }),
      ]);

      const mapped = reports.map(({ _count, ...r }) => ({ ...r, screenshotCount: _count.screenshots }));

      res.json({
        success: true,
        data: {
          reports: mapped,
          pagination: { page, limit, total, pages: Math.ceil(total / limit) },
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/reports/:id — Get a single report with screenshots */
router.get(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = param(req, 'id');
      const report = await prisma.report.findUnique({
        where: { id },
        include: {
          screenshots: {
            orderBy: { index: 'asc' },
          },
        },
      });

      if (!report) {
        throw new NotFoundError('Report');
      }

      if (report.userId !== req.user!.id) {
        throw new ForbiddenError('You do not own this report');
      }

      res.json({
        success: true,
        data: { report },
      });
    } catch (error) {
      next(error);
    }
  },
);

/** PATCH /api/reports/:id — Update report metadata */
router.patch(
  '/:id',
  requireAuth,
  validate(updateReportSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = param(req, 'id');
      const existing = await prisma.report.findUnique({
        where: { id },
        select: { userId: true, status: true },
      });

      if (!existing) {
        throw new NotFoundError('Report');
      }

      if (existing.userId !== req.user!.id) {
        throw new ForbiddenError('You do not own this report');
      }

      if (existing.status !== 'pending' && existing.status !== 'failed') {
        throw new ValidationError('Cannot update a report that is already processing');
      }

      const report = await prisma.report.update({
        where: { id },
        data: req.body,
      });

      res.json({
        success: true,
        data: { report },
      });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /api/reports/:id — Delete a report and its screenshots */
router.delete(
  '/:id',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = param(req, 'id');
      const existing = await prisma.report.findUnique({
        where: { id },
        select: { userId: true },
      });

      if (!existing) {
        throw new NotFoundError('Report');
      }

      if (existing.userId !== req.user!.id) {
        throw new ForbiddenError('You do not own this report');
      }

      // Collect all storage URLs before deleting the DB record
      const [screenshots, reportData] = await Promise.all([
        prisma.screenshot.findMany({ where: { reportId: id }, select: { url: true } }),
        prisma.report.findUnique({ where: { id }, select: { pdfUrl: true, texUrl: true } }),
      ]);

      await prisma.report.delete({ where: { id } }); // cascades to Screenshot rows

      // Best-effort cleanup of storage files (don't fail the request if storage delete fails)
      const deletePromises: Promise<void>[] = [
        ...screenshots.map((s) => deleteStorageFile(s.url)),
        ...(reportData?.pdfUrl ? [deleteStorageFile(reportData.pdfUrl)] : []),
        ...(reportData?.texUrl ? [deleteStorageFile(reportData.texUrl)] : []),
      ];
      await Promise.allSettled(deletePromises);

      logger.info('Report deleted', { reportId: id, userId: req.user!.id });

      res.json({
        success: true,
        message: 'Report deleted',
      });
    } catch (error) {
      next(error);
    }
  },
);

/** POST /api/reports/:id/generate — Trigger the report generation pipeline */
router.post(
  '/:id/generate',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = param(req, 'id');
      const report = await prisma.report.findUnique({
        where: { id },
        include: {
          screenshots: {
            where: { excluded: false },
            orderBy: { index: 'asc' },
          },
        },
      });

      if (!report) {
        throw new NotFoundError('Report');
      }

      if (report.userId !== req.user!.id) {
        throw new ForbiddenError('You do not own this report');
      }

      if (['processing', 'reviewing', 'writing', 'compiling', 'queued'].includes(report.status)) {
        throw new ValidationError('Report is already being generated');
      }

      if (report.screenshots.length === 0) {
        throw new ValidationError('Report must have at least one screenshot');
      }

      // Mark as queued
      await prisma.report.update({
        where: { id: report.id },
        data: { status: 'queued', currentStage: 'queued', errorMessage: null },
      });

      // Add to BullMQ queue
      await reportQueue.add('generate', {
        reportId: report.id,
        userId: req.user!.id,
      });

      logger.info('Report generation queued', { reportId: report.id });

      res.json({
        success: true,
        message: 'Report generation queued',
        data: { reportId: report.id, status: 'queued' },
      });
    } catch (error) {
      next(error);
    }
  },
);

/** GET /api/reports/:id/stream — SSE stream for real-time pipeline status */
router.get(
  '/:id/stream',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    const id = param(req, 'id');

    // Verify ownership before committing to SSE
    let report: {
      userId: string;
      status: string;
      currentStage: string | null;
      frameCount: number | null;
      sectionCount: number | null;
      errorMessage: string | null;
      pdfUrl: string | null;
      texUrl: string | null;
    } | null;

    try {
      report = await prisma.report.findUnique({
        where: { id },
        select: {
          userId: true,
          status: true,
          currentStage: true,
          frameCount: true,
          sectionCount: true,
          errorMessage: true,
          pdfUrl: true,
          texUrl: true,
        },
      });
    } catch (error) {
      return next(error);
    }

    if (!report) return next(new NotFoundError('Report'));
    if (report.userId !== req.user!.id) return next(new ForbiddenError('You do not own this report'));

    // Headers committed — no more next(error) after this point
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // If already terminal, send state and close immediately
    if (report.status === 'completed' || report.status === 'failed') {
      const { userId: _u, ...terminalPayload } = report;
      res.write(`data: ${JSON.stringify(terminalPayload)}\n\n`);
      return res.end();
    }

    const sub = createSubscriber();
    let cleaned = false;
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (heartbeat !== undefined) clearInterval(heartbeat);
      if (timeout !== undefined) clearTimeout(timeout);
      sub.disconnect();
    };

    sub.on('message', (_channel, data) => {
      res.write(`data: ${data}\n\n`);
      try {
        const parsed = JSON.parse(data) as { status: string };
        if (parsed.status === 'completed' || parsed.status === 'failed') {
          cleanup();
          res.end();
        }
      } catch { /* ignore parse errors */ }
    });

    // Subscribe first, then re-read DB to catch any events that fired during setup
    // (fixes race: pipeline could complete between initial DB read and subscribe)
    try {
      await new Promise<void>((resolve, reject) => {
        sub.subscribe(`job:${id}`, (err) => (err ? reject(err) : resolve()));
      });
    } catch (err) {
      logger.error('SSE Redis subscribe error', { reportId: id, error: (err as Error).message });
      cleanup();
      return res.end();
    }

    // Catch-up read: if pipeline completed while we were subscribing, emit it now.
    // Guard with !cleaned because a live 'message' event may have already
    // fired (and closed the response) while this DB query was in-flight.
    try {
      const current = await prisma.report.findUnique({
        where: { id },
        select: { status: true, currentStage: true, frameCount: true, sectionCount: true, errorMessage: true, pdfUrl: true, texUrl: true },
      });
      if (current && !cleaned) {
        res.write(`data: ${JSON.stringify(current)}\n\n`);
        if (current.status === 'completed' || current.status === 'failed') {
          cleanup();
          return res.end();
        }
      }
    } catch { /* if catch-up read fails, proceed — live events will still arrive */ }

    heartbeat = setInterval(() => {
      res.write(': ping\n\n');
    }, 30_000);

    timeout = setTimeout(() => {
      cleanup();
      res.end();
    }, 10 * 60 * 1000);

    req.on('close', cleanup);
  },
);

/** GET /api/reports/:id/status — Get pipeline status for polling */
router.get(
  '/:id/status',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = param(req, 'id');
      const report = await prisma.report.findUnique({
        where: { id },
        select: {
          id: true,
          userId: true,
          status: true,
          currentStage: true,
          frameCount: true,
          sectionCount: true,
          errorMessage: true,
          pdfUrl: true,
          texUrl: true,
        },
      });

      if (!report) {
        throw new NotFoundError('Report');
      }

      if (report.userId !== req.user!.id) {
        throw new ForbiddenError('You do not own this report');
      }

      res.json({
        success: true,
        data: {
          id: report.id,
          status: report.status,
          currentStage: report.currentStage,
          frameCount: report.frameCount,
          sectionCount: report.sectionCount,
          errorMessage: report.errorMessage,
          pdfUrl: report.pdfUrl,
          texUrl: report.texUrl,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// --- Edit schema ---

const editReportSchema = z.object({
  message: z.string().min(1).max(2000),
  imageUrl: z.string().url().optional(),
});

/** POST /api/reports/:id/edit — AI-powered document editing (no queue, direct) */
router.post(
  '/:id/edit',
  requireAuth,
  validate(editReportSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = param(req, 'id');
      const { message, imageUrl } = req.body as { message: string; imageUrl?: string };

      const report = await prisma.report.findUnique({
        where: { id },
        select: {
          userId: true,
          status: true,
          texUrl: true,
          pdfUrl: true,
          chatMessages: true,
          title: true,
          company: true,
          role: true,
          language: true,
          style: true,
        },
      });

      if (!report) throw new NotFoundError('Report');
      if (report.userId !== req.user!.id) throw new ForbiddenError('You do not own this report');
      if (report.status !== 'completed') throw new ValidationError('Report must be completed before editing');
      if (!report.texUrl) throw new ValidationError('No LaTeX source found for this report');

      const chatHistory = (report.chatMessages as { role: string; content: string }[] | null) ?? [];

      const result = await applyDocumentEdit({
        reportId: id,
        texUrl: report.texUrl,
        message,
        imageUrl,
        chatHistory,
        reportContext: {
          title: report.title,
          company: report.company,
          role: report.role,
          language: report.language,
          style: report.style,
        },
      });

      // Append the exchange to chatMessages for context in future edits
      const updatedHistory = [
        ...chatHistory,
        { role: 'user', content: message, timestamp: new Date().toISOString() },
        { role: 'assistant', content: result.summary, timestamp: new Date().toISOString() },
      ];

      await prisma.report.update({
        where: { id },
        data: {
          pdfUrl: result.pdfUrl ?? report.pdfUrl,
          texUrl: result.texUrl,
          chatMessages: updatedHistory,
        },
      });

      logger.info('Document edit applied', { reportId: id, userId: req.user!.id });

      res.json({
        success: true,
        data: {
          pdfUrl: result.pdfUrl ?? report.pdfUrl,
          texUrl: result.texUrl,
          message: result.summary,
          chatMessages: updatedHistory,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /api/reports/:id/versions/:version — Delete a historical version and its storage files */
router.delete(
  '/:id/versions/:version',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = param(req, 'id');
      const versionNum = parseInt(param(req, 'version'));
      if (isNaN(versionNum)) throw new ValidationError('Invalid version number');

      const report = await prisma.report.findUnique({
        where: { id },
        select: { userId: true, versions: true },
      });

      if (!report) throw new NotFoundError('Report');
      if (report.userId !== req.user!.id) throw new ForbiddenError('You do not own this report');

      type VersionEntry = { version: number; pdfUrl: string; texUrl?: string; createdAt: string; label?: string };
      const versions: VersionEntry[] = Array.isArray(report.versions) ? (report.versions as VersionEntry[]) : [];
      const toDelete = versions.find((v) => v.version === versionNum);

      if (!toDelete) throw new NotFoundError('Report version');

      const deletions: Promise<void>[] = [];
      if (toDelete.pdfUrl) deletions.push(deleteStorageFile(toDelete.pdfUrl).catch(() => {}));
      if (toDelete.texUrl) deletions.push(deleteStorageFile(toDelete.texUrl).catch(() => {}));
      await Promise.allSettled(deletions);

      await prisma.report.update({
        where: { id },
        data: { versions: versions.filter((v) => v.version !== versionNum) },
      });

      logger.info('Report version deleted', { reportId: id, version: versionNum, userId: req.user!.id });
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

export default router;
