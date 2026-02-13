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

  // Compute blur score + perceptual hash in a single sharp decode per image.
  // Previously done in two separate Promise.all passes (two decodes each); now one.
  const analyzed = await Promise.all(
    screenshots.map(async (screenshot) => {
      const { blurScore, hash } = await computeImageMetrics(screenshot.imageBuffer);
      return { ...screenshot, blurScore, hash };
    }),
  );

  const results: ReviewResult[] = [];
  const seen: { hash: string; index: number }[] = [];

  for (const screenshot of analyzed) {
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
      const h = analyzed.find((x) => x.id === r.screenshotId)!;
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
 * Compute blur score and perceptual hash in a single sharp decode.
 *
 * Decodes the image once to 256x256 grayscale for the Laplacian blur analysis,
 * then re-uses that raw pixel data (resized to 8x8) for the perceptual hash —
 * avoiding a second full decode of the original compressed image.
 */
async function computeImageMetrics(imageBuffer: Buffer): Promise<{ blurScore: number; hash: string }> {
  try {
    // Decode once to 256x256 grayscale raw pixels
    const { data: blurData, info } = await sharp(imageBuffer)
      .grayscale()
      .resize(256, 256, { fit: 'inside' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    // Blur: Laplacian variance (high variance = sharp image = low score)
    const width = info.width;
    const height = info.height;
    let laplacianSum = 0;
    let count = 0;

    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const laplacian =
          -blurData[idx - width] -
          blurData[idx - 1] +
          4 * blurData[idx] -
          blurData[idx + 1] -
          blurData[idx + width];
        laplacianSum += laplacian * laplacian;
        count++;
      }
    }

    const variance = laplacianSum / count;
    const blurScore = Math.max(0, Math.min(1, 1 - variance / 1000));

    // Hash: resize the already-decoded 256x256 raw data down to 8x8 — no second JPEG/PNG decode
    const { data: hashData } = await sharp(blurData, {
      raw: { width: info.width, height: info.height, channels: 1 },
    })
      .resize(8, 8, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });

    const avg = Array.from(hashData).reduce((sum, v) => sum + v, 0) / hashData.length;
    let hash = '';
    for (let i = 0; i < hashData.length; i++) {
      hash += hashData[i] >= avg ? '1' : '0';
    }

    return { blurScore, hash };
  } catch (error) {
    logger.error('Failed to compute image metrics — treating as unreadable and excluding', { error });
    // blurScore: 1.0 = maximally blurry on the inverted scale (0=sharp, 1=blurry).
    // This ensures corrupt/unreadable buffers are excluded by the blur filter rather
    // than silently passed to the vision stage where sharp would crash again.
    return {
      blurScore: 1.0,
      hash: Array.from({ length: 64 }, () => (Math.random() < 0.5 ? '0' : '1')).join(''),
    };
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
