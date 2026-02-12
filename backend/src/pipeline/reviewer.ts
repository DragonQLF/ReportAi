import sharp from 'sharp';
import { logger } from '../utils/logger';
import { PipelineError } from '../utils/errors';
import type { ReviewOutput, ReviewResult } from './schemas';

interface ReviewInput {
  screenshots: {
    id: string;
    index: number;
    imageBuffer: Buffer;
  }[];
  options?: {
    blurThreshold?: number;   // 0-1, default 0.3 — images above this are blurry
    duplicateThreshold?: number; // 0-1, default 0.95 — pHash similarity above this means duplicate
    minFrames?: number;        // minimum frames required, default 3
  };
}

const DEFAULT_BLUR_THRESHOLD = 0.95; // UI screenshots have low Laplacian variance by nature — only reject near-solid images
const DEFAULT_DUPLICATE_THRESHOLD = 0.95;
const DEFAULT_MIN_FRAMES = 2;

/**
 * Review screenshots for quality: blur detection, duplicate removal, and frame count validation.
 * Uses sharp for image analysis and a perceptual hash for deduplication.
 */
export async function reviewScreenshots(input: ReviewInput): Promise<ReviewOutput> {
  const {
    screenshots,
    options = {},
  } = input;

  const blurThreshold = options.blurThreshold ?? DEFAULT_BLUR_THRESHOLD;
  const duplicateThreshold = options.duplicateThreshold ?? DEFAULT_DUPLICATE_THRESHOLD;
  const minFrames = options.minFrames ?? DEFAULT_MIN_FRAMES;

  logger.info('Starting screenshot review', {
    count: screenshots.length,
    blurThreshold,
    duplicateThreshold,
  });

  const results: ReviewResult[] = [];

  // Step 1: Compute blur scores for all screenshots
  const blurScores = await Promise.all(
    screenshots.map(async (screenshot) => {
      const score = await computeBlurScore(screenshot.imageBuffer);
      return { ...screenshot, blurScore: score };
    }),
  );

  // Step 2: Compute perceptual hashes for deduplication
  const hashes = await Promise.all(
    blurScores.map(async (screenshot) => {
      const hash = await computePerceptualHash(screenshot.imageBuffer);
      return { ...screenshot, hash };
    }),
  );

  // Step 3: Mark blurry and duplicate screenshots
  const seen: { hash: string; index: number }[] = [];

  for (const screenshot of hashes) {
    const isBlurry = screenshot.blurScore > blurThreshold;

    let isDuplicate = false;
    let duplicateOf: number | null = null;

    if (!isBlurry) {
      // Check for duplicates against previously seen non-blurry frames
      for (const prev of seen) {
        const similarity = computeHashSimilarity(screenshot.hash, prev.hash);
        if (similarity >= duplicateThreshold) {
          isDuplicate = true;
          duplicateOf = prev.index;
          break;
        }
      }

      if (!isDuplicate) {
        seen.push({ hash: screenshot.hash, index: screenshot.index });
      }
    }

    const keep = !isBlurry && !isDuplicate;

    results.push({
      screenshotId: screenshot.id,
      index: screenshot.index,
      blurScore: screenshot.blurScore,
      isDuplicate,
      duplicateOf,
      keep,
      reason: isBlurry
        ? `Blur score ${screenshot.blurScore.toFixed(2)} exceeds threshold ${blurThreshold}`
        : isDuplicate
          ? `Duplicate of screenshot ${duplicateOf}`
          : undefined,
    });
  }

  const keptCount = results.filter((r) => r.keep).length;
  const removedCount = results.length - keptCount;

  if (keptCount < minFrames) {
    logger.warn('Not enough frames after review, retrying with lenient threshold', { keptCount, minFrames });
    const lenientThreshold = Math.min(blurThreshold + 0.3, 1.0);

    const lenientResults = results.map((r) => {
      const h = hashes.find((x) => x.id === r.screenshotId)!;
      const isBlurry = h.blurScore > lenientThreshold;
      return { ...r, keep: !isBlurry && !r.isDuplicate };
    });

    const lenientKept = lenientResults.filter((r) => r.keep).length;
    if (lenientKept < minFrames) {
      throw new PipelineError(
        'reviewer',
        `Only ${lenientKept} screenshots passed review (minimum: ${minFrames}). Upload more or clearer screenshots.`,
      );
    }

    logger.info('Lenient review passed', { keptCount: lenientKept });
    return { results: lenientResults, keptCount: lenientKept, removedCount: lenientResults.length - lenientKept };
  }

  logger.info('Screenshot review complete', { keptCount, removedCount });

  return {
    results,
    keptCount,
    removedCount,
  };
}

/**
 * Compute a blur score for an image using Laplacian variance.
 * Returns a value between 0 (sharp) and 1 (very blurry).
 */
async function computeBlurScore(imageBuffer: Buffer): Promise<number> {
  try {
    // Convert to grayscale and get raw pixel data
    const { data, info } = await sharp(imageBuffer)
      .grayscale()
      .resize(256, 256, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Compute Laplacian variance as a measure of sharpness
    const width = info.width;
    const height = info.height;
    let laplacianSum = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const laplacian =
          -data[idx - width] -
          data[idx - 1] +
          4 * data[idx] -
          data[idx + 1] -
          data[idx + width];
        laplacianSum += laplacian * laplacian;
        count++;
      }
    }

    const variance = laplacianSum / count;

    // Normalize: high variance = sharp (low score), low variance = blurry (high score)
    // Typical thresholds: variance < 100 is quite blurry
    const normalizedScore = Math.max(0, Math.min(1, 1 - variance / 1000));

    return normalizedScore;
  } catch (error) {
    logger.error('Failed to compute blur score', { error });
    return 0; // Assume sharp on error (don't exclude)
  }
}

/**
 * Compute a simple perceptual hash (average hash) for an image.
 * Returns a 64-char binary string (one bit per 8x8 pixel vs average).
 */
async function computePerceptualHash(imageBuffer: Buffer): Promise<string> {
  try {
    // Resize to 8x8 grayscale
    const { data } = await sharp(imageBuffer)
      .grayscale()
      .resize(8, 8, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Compute average pixel value
    const avg = data.reduce((sum, val) => sum + val, 0) / data.length;

    // Build hash: 1 if pixel >= average, 0 otherwise
    // Return as 64-char binary string — do NOT convert via parseInt(), which loses
    // precision for values > 2^53 (JavaScript's safe integer limit).
    let hash = '';
    for (let i = 0; i < data.length; i++) {
      hash += data[i] >= avg ? '1' : '0';
    }
    return hash;
  } catch (error) {
    logger.error('Failed to compute perceptual hash', { error });
    // Return random 64-bit binary string so it won't match anything
    return Array.from({ length: 64 }, () => (Math.random() < 0.5 ? '0' : '1')).join('');
  }
}

/**
 * Compute similarity between two perceptual hashes (64-char binary strings).
 * Returns a value between 0 (completely different) and 1 (identical).
 * Uses string-based Hamming distance — no integer conversion, no overflow risk.
 */
function computeHashSimilarity(hash1: string, hash2: string): number {
  if (hash1.length !== hash2.length) return 0;

  let matchingBits = 0;
  for (let i = 0; i < hash1.length; i++) {
    if (hash1[i] === hash2[i]) matchingBits++;
  }

  return matchingBits / hash1.length;
}
