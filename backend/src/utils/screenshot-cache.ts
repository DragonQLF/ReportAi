import { mkdir, writeFile, readFile, stat } from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';
import { logger } from './logger';

const CACHE_BASE = path.join(tmpdir(), 'reportai-screenshots');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function reportDir(reportId: string): string {
  return path.join(CACHE_BASE, reportId);
}

/**
 * Write a converted PNG to the filesystem cache for this report.
 * Non-fatal — cache write failures are logged and swallowed.
 */
export async function cacheScreenshotPng(reportId: string, filename: string, pngBuffer: Buffer): Promise<void> {
  try {
    await mkdir(reportDir(reportId), { recursive: true });
    await writeFile(path.join(reportDir(reportId), `${filename}.png`), pngBuffer);
  } catch (err) {
    logger.warn('Screenshot cache write failed', { reportId, filename, err });
  }
}

/**
 * Attempt to load all screenshots for a report from the filesystem cache.
 * Returns null on any cache miss so the caller falls back to R2.
 */
export async function getScreenshotCache(
  reportId: string,
  filenames: string[],
): Promise<{ filename: string; buffer: Buffer }[] | null> {
  if (filenames.length === 0) return [];

  try {
    // Check age via the first file's mtime — if stale, treat as full miss
    const first = path.join(reportDir(reportId), `${filenames[0]}.png`);
    const { mtimeMs } = await stat(first);
    if (Date.now() - mtimeMs > CACHE_TTL_MS) {
      logger.debug('Screenshot cache expired', { reportId });
      return null;
    }

    const buffers = await Promise.all(
      filenames.map(async (filename) => ({
        filename,
        buffer: await readFile(path.join(reportDir(reportId), `${filename}.png`)),
      })),
    );
    logger.debug('Screenshot cache hit', { reportId, count: filenames.length });
    return buffers;
  } catch {
    // Any single miss → full cache miss, caller fetches from R2
    return null;
  }
}
