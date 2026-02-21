import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';
import { requireAuth } from '../middleware/auth';
import { prisma } from '../utils/prisma';
import { NotFoundError, ForbiddenError, ValidationError } from '../utils/errors';
import { uploadScreenshot, deleteStorageFile, uploadDocumentFile } from '../storage/screenshot-storage.service';
import { flashModel } from '../pipeline/ai';
import { generateText } from 'ai';
import { logger } from '../utils/logger';

const execFileAsync = promisify(execFile);

// Scene-change sensitivity: 0–1, higher = less sensitive.
// 0.2 catches page navigations, modal opens, major content changes.
const SCENE_THRESHOLD = 0.2;
const MAX_VIDEO_FRAMES = 30;

async function extractVideoFrames(videoBuffer: Buffer): Promise<Buffer[]> {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'reportai-'));
  const videoPath = path.join(tempDir, 'input.mp4');
  const outputPattern = path.join(tempDir, 'frame_%03d.png');

  try {
    await writeFile(videoPath, videoBuffer);

    // Primary pass: extract frames only on scene changes.
    // Uses ffmpeg's built-in SAD-based scene detector — far better than fixed fps
    // for screen recordings where most frames are visually identical.
    // -vsync vfr: variable frame rate output (required with select filter).
    try {
      await execFileAsync('ffmpeg', [
        '-i', videoPath,
        '-vf', `select=gt(scene,${SCENE_THRESHOLD})`,
        '-vsync', 'vfr',
        '-frames:v', String(MAX_VIDEO_FRAMES),
        outputPattern,
      ]);
    } catch {
      // ffmpeg may exit non-zero when no frames match the scene filter; ignore.
    }

    let frameFiles = (await readdir(tempDir))
      .filter((f) => f.startsWith('frame_') && f.endsWith('.png'))
      .sort();

    // Fallback: if scene detection found too few frames (e.g. static video or
    // very slow recording), revert to time-based extraction at 1 frame / 5 s.
    if (frameFiles.length < 3) {
      logger.info('Scene detection yielded too few frames, falling back to time-based extraction', {
        found: frameFiles.length,
      });
      await Promise.all(frameFiles.map((f) => rm(path.join(tempDir, f)).catch(() => {})));

      await execFileAsync('ffmpeg', [
        '-i', videoPath,
        '-vf', 'fps=1/5',
        '-frames:v', String(MAX_VIDEO_FRAMES),
        outputPattern,
      ]);

      frameFiles = (await readdir(tempDir))
        .filter((f) => f.startsWith('frame_') && f.endsWith('.png'))
        .sort();
    }

    return Promise.all(frameFiles.map((f) => readFile(path.join(tempDir, f))));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

const router = Router();

/** Extract route param as string (Express 5 types params as string | string[]) */
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0] : val;
}

// Configure multer for memory storage (we'll upload to R2)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024, // 200MB per file (to support video uploads)
    files: 50, // max 50 files at once
  },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'image/png', 'image/jpeg', 'image/webp',
      'video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ValidationError(`Invalid file type: ${file.mimetype}. Allowed: PNG, JPEG, WebP, MP4, MOV, WebM`));
    }
  },
});

/** POST /api/upload/:reportId — Upload screenshots for a report */
router.post(
  '/:reportId',
  requireAuth,
  upload.array('screenshots', 50),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reportId = param(req, 'reportId');

      // Verify report ownership
      const report = await prisma.report.findUnique({
        where: { id: reportId },
        select: { userId: true, status: true },
      });

      if (!report) {
        throw new NotFoundError('Report');
      }

      if (report.userId !== req.user!.id) {
        throw new ForbiddenError('You do not own this report');
      }

      if (report.status !== 'pending' && report.status !== 'failed' && report.status !== 'completed') {
        throw new ValidationError('Cannot upload screenshots to a report that is being processed');
      }

      const files = req.files as Express.Multer.File[];
      if (!files || files.length === 0) {
        throw new ValidationError('No files uploaded');
      }

      // Expand video files into PNG frames
      const expandedFiles: Array<{ buffer: Buffer; mimetype: string }> = [];
      for (const file of files) {
        if (file.mimetype.startsWith('video/')) {
          logger.info('Extracting frames from video', { reportId, originalname: file.originalname });
          const frames = await extractVideoFrames(file.buffer);
          frames.forEach((buf) => expandedFiles.push({ buffer: buf, mimetype: 'image/png' }));
        } else {
          expandedFiles.push({ buffer: file.buffer, mimetype: file.mimetype });
        }
      }
      if (expandedFiles.length === 0) throw new ValidationError('No files uploaded');

      // Get current max index for this report
      const maxIndex = await prisma.screenshot.aggregate({
        where: { reportId },
        _max: { index: true },
      });
      let nextIndex = (maxIndex._max?.index ?? -1) + 1;

      // Upload each file to R2 and create DB records
      const screenshots = await Promise.all(
        expandedFiles.map(async (file, i) => {
          const index = nextIndex + i;
          const url = await uploadScreenshot(file.buffer, {
            reportId,
            index,
            mimetype: file.mimetype,
          });

          return prisma.screenshot.create({
            data: {
              reportId,
              url,
              index,
            },
          });
        }),
      );

      logger.info('Screenshots uploaded', {
        reportId,
        count: screenshots.length,
        userId: req.user!.id,
      });

      res.status(201).json({
        success: true,
        data: { screenshots },
      });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /api/upload/:reportId/:screenshotId — Delete a single screenshot */
router.delete(
  '/:reportId/:screenshotId',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reportId = param(req, 'reportId');
      const screenshotId = param(req, 'screenshotId');

      const report = await prisma.report.findUnique({
        where: { id: reportId },
        select: { userId: true, status: true },
      });

      if (!report) {
        throw new NotFoundError('Report');
      }

      if (report.userId !== req.user!.id) {
        throw new ForbiddenError('You do not own this report');
      }

      const screenshot = await prisma.screenshot.findUnique({
        where: { id: screenshotId },
      });

      if (!screenshot || screenshot.reportId !== reportId) {
        throw new NotFoundError('Screenshot');
      }

      // Delete from R2
      await deleteStorageFile(screenshot.url);

      // Delete from DB
      await prisma.screenshot.delete({
        where: { id: screenshotId },
      });

      logger.info('Screenshot deleted', { reportId, screenshotId });

      res.json({
        success: true,
        message: 'Screenshot deleted',
      });
    } catch (error) {
      next(error);
    }
  },
);

// Multer for document uploads — PDF and plain text only, 20 MB max
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['application/pdf', 'text/plain', 'text/markdown', 'text/x-markdown'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ValidationError(`Invalid file type: ${file.mimetype}. Allowed: PDF, plain text`));
    }
  },
});

/**
 * Extract text from a document buffer.
 * - Text files: decoded as UTF-8 directly.
 * - PDFs: sent to Gemini Flash as a file part for native extraction.
 */
async function extractDocumentText(buffer: Buffer, mimetype: string, filename: string): Promise<string> {
  if (mimetype === 'application/pdf') {
    logger.info('Extracting text from PDF via Gemini Flash', { filename });
    const { text } = await generateText({
      model: flashModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'file', data: buffer, mediaType: 'application/pdf' },
            { type: 'text', text: 'Extract all text content from this document verbatim. Preserve structure: headings, lists, numbering. Return plain text only.' },
          ],
        },
      ],
    });
    return text;
  }
  // Plain text / markdown
  return buffer.toString('utf-8');
}

/** POST /api/upload/:reportId/document — Upload a reference document (PDF or text) */
router.post(
  '/:reportId/document',
  requireAuth,
  documentUpload.single('document'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reportId = param(req, 'reportId');

      const report = await prisma.report.findUnique({
        where: { id: reportId },
        select: { userId: true, status: true, contextDocuments: true },
      });

      if (!report) throw new NotFoundError('Report');
      if (report.userId !== req.user!.id) throw new ForbiddenError('You do not own this report');
      if (report.status !== 'pending' && report.status !== 'failed') {
        throw new ValidationError('Cannot upload documents to a report that is being processed or completed');
      }

      const file = req.file;
      if (!file) throw new ValidationError('No file uploaded');

      const text = await extractDocumentText(file.buffer, file.mimetype, file.originalname);

      const url = await uploadDocumentFile(file.buffer, {
        reportId,
        filename: `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`,
        contentType: file.mimetype,
      });

      type ContextDoc = { name: string; url: string; text: string };
      const existing: ContextDoc[] = Array.isArray(report.contextDocuments)
        ? (report.contextDocuments as ContextDoc[])
        : [];

      const newDoc: ContextDoc = { name: file.originalname, url, text };
      const updated = await prisma.report.update({
        where: { id: reportId },
        data: { contextDocuments: [...existing, newDoc] },
      });

      logger.info('Document uploaded', { reportId, name: file.originalname, chars: text.length });

      res.status(201).json({
        success: true,
        data: {
          document: newDoc,
          contextDocuments: updated.contextDocuments,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// Multer for logo uploads — PNG/JPEG/WebP only, 5 MB max
const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new ValidationError(`Invalid file type: ${file.mimetype}. Allowed: PNG, JPEG, WebP`));
    }
  },
});

/** POST /api/upload/:reportId/logo — Upload a logo image for the report */
router.post(
  '/:reportId/logo',
  requireAuth,
  logoUpload.single('logo'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reportId = param(req, 'reportId');

      const report = await prisma.report.findUnique({
        where: { id: reportId },
        select: { userId: true, layoutConfig: true },
      });

      if (!report) throw new NotFoundError('Report');
      if (report.userId !== req.user!.id) throw new ForbiddenError('You do not own this report');

      const file = req.file;
      if (!file) throw new ValidationError('No file uploaded');

      const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
      const logoUrl = await uploadDocumentFile(file.buffer, {
        reportId,
        filename: `logo.${ext}`,
        contentType: file.mimetype,
      });

      // Delete previous logo from storage if present
      const existing = report.layoutConfig as Record<string, unknown> | null;
      if (existing?.logoUrl && typeof existing.logoUrl === 'string') {
        await deleteStorageFile(existing.logoUrl).catch(() => {});
      }

      const updatedConfig = { ...(existing ?? {}), logoUrl };
      await prisma.report.update({
        where: { id: reportId },
        data: { layoutConfig: updatedConfig },
      });

      logger.info('Logo uploaded', { reportId, logoUrl });
      res.status(201).json({ logoUrl });
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /api/upload/:reportId/logo — Remove logo from the report */
router.delete(
  '/:reportId/logo',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reportId = param(req, 'reportId');

      const report = await prisma.report.findUnique({
        where: { id: reportId },
        select: { userId: true, layoutConfig: true },
      });

      if (!report) throw new NotFoundError('Report');
      if (report.userId !== req.user!.id) throw new ForbiddenError('You do not own this report');

      const existing = report.layoutConfig as Record<string, unknown> | null;
      if (existing?.logoUrl && typeof existing.logoUrl === 'string') {
        await deleteStorageFile(existing.logoUrl).catch(() => {});
      }

      const updatedConfig = { ...(existing ?? {}), logoUrl: undefined };
      delete (updatedConfig as Record<string, unknown>).logoUrl;
      await prisma.report.update({
        where: { id: reportId },
        data: { layoutConfig: updatedConfig },
      });

      logger.info('Logo removed', { reportId });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  },
);

/** DELETE /api/upload/:reportId/document/:docIndex — Remove a reference document */
router.delete(
  '/:reportId/document/:docIndex',
  requireAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reportId = param(req, 'reportId');
      const docIndex = parseInt(param(req, 'docIndex'), 10);

      const report = await prisma.report.findUnique({
        where: { id: reportId },
        select: { userId: true, contextDocuments: true },
      });

      if (!report) throw new NotFoundError('Report');
      if (report.userId !== req.user!.id) throw new ForbiddenError('You do not own this report');

      type ContextDoc = { name: string; url: string; text: string };
      const docs: ContextDoc[] = Array.isArray(report.contextDocuments)
        ? (report.contextDocuments as ContextDoc[])
        : [];

      if (docIndex < 0 || docIndex >= docs.length) throw new NotFoundError('Document');

      const [removed] = docs.splice(docIndex, 1);
      await deleteStorageFile(removed.url).catch(() => {});
      await prisma.report.update({ where: { id: reportId }, data: { contextDocuments: docs } });

      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
