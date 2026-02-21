import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, writeFile, readFile, unlink } from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AppError } from '../utils/errors';

const s3Client =
  config.storage.mode === 'r2'
    ? new S3Client({
        region: 'auto',
        endpoint: `https://${config.r2.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: config.r2.accessKeyId,
          secretAccessKey: config.r2.secretAccessKey,
        },
      })
    : null;

interface UploadOptions {
  reportId: string;
  index: number;
  mimetype: string;
}

/**
 * Upload a screenshot buffer to Cloudflare R2 or local filesystem.
 * Returns the public URL of the uploaded file.
 */
export async function uploadScreenshot(
  buffer: Buffer,
  options: UploadOptions,
): Promise<string> {
  const { reportId, index, mimetype } = options;
  const ext = mimetype === 'image/png' ? 'png' : mimetype === 'image/webp' ? 'webp' : 'jpg';
  const filename = `${index}-${uuidv4()}.${ext}`;

  if (config.storage.mode === 'local') {
    const dir = path.join(config.storage.localDir, 'screenshots', reportId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), buffer);
    const url = `${config.storage.localPublicUrl}/screenshots/${reportId}/${filename}`;
    logger.debug('Screenshot saved to local storage', { url });
    return url;
  }

  const key = `screenshots/${reportId}/${filename}`;
  try {
    await s3Client!.send(
      new PutObjectCommand({
        Bucket: config.r2.bucketName,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
      }),
    );

    const url = `${config.r2.publicUrl}/${key}`;
    logger.debug('Screenshot uploaded to R2', { key, url });
    return url;
  } catch (error) {
    logger.error('Failed to upload screenshot to R2', { key, error });
    throw new AppError('Failed to upload screenshot', 500, 'STORAGE_ERROR');
  }
}

/**
 * Upload a generated PDF or TeX file to R2 or local filesystem.
 * Returns the public URL.
 */
export async function uploadOutput(
  buffer: Buffer,
  options: { reportId: string; filename: string; contentType: string },
): Promise<string> {
  if (config.storage.mode === 'local') {
    const dir = path.join(config.storage.localDir, 'outputs', options.reportId);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, options.filename), buffer);
    const url = `${config.storage.localPublicUrl}/outputs/${options.reportId}/${options.filename}`;
    logger.debug('Output file saved to local storage', { url });
    return url;
  }

  const key = `outputs/${options.reportId}/${options.filename}`;
  try {
    await s3Client!.send(
      new PutObjectCommand({
        Bucket: config.r2.bucketName,
        Key: key,
        Body: buffer,
        ContentType: options.contentType,
      }),
    );

    const url = `${config.r2.publicUrl}/${key}`;
    logger.debug('Output file uploaded to R2', { key, url });
    return url;
  } catch (error) {
    logger.error('Failed to upload output to R2', { key, error });
    throw new AppError('Failed to upload output file', 500, 'STORAGE_ERROR');
  }
}

/**
 * Upload a user-provided reference document (PDF, text) to R2 or local filesystem.
 */
export async function uploadDocumentFile(
  buffer: Buffer,
  options: { reportId: string; filename: string; contentType: string },
): Promise<string> {
  return uploadOutput(buffer, {
    reportId: options.reportId,
    filename: `documents/${options.filename}`,
    contentType: options.contentType,
  });
}

/**
 * Delete a file by its public URL from R2 or local filesystem.
 */
export async function deleteStorageFile(url: string): Promise<void> {
  if (config.storage.mode === 'local') {
    const basePath = new URL(config.storage.localPublicUrl).pathname.replace(/\/?$/, '/');
    const relativePath = new URL(url).pathname.replace(basePath, '');
    const filePath = path.join(config.storage.localDir, relativePath);
    try {
      await unlink(filePath);
      logger.debug('File deleted from local storage', { filePath });
    } catch (error) {
      logger.error('Failed to delete file from local storage', { filePath, error });
      throw new AppError('Failed to delete file', 500, 'STORAGE_ERROR');
    }
    return;
  }

  const key = url.replace(`${config.r2.publicUrl}/`, '');
  try {
    await s3Client!.send(
      new DeleteObjectCommand({
        Bucket: config.r2.bucketName,
        Key: key,
      }),
    );
    logger.debug('File deleted from R2', { key });
  } catch (error) {
    logger.error('Failed to delete file from R2', { key, error });
    throw new AppError('Failed to delete file', 500, 'STORAGE_ERROR');
  }
}

/**
 * Download a file into a Buffer from R2 or local filesystem.
 */
export async function downloadFromR2(url: string): Promise<Buffer> {
  if (config.storage.mode === 'local') {
    const basePath = new URL(config.storage.localPublicUrl).pathname.replace(/\/?$/, '/');
    const relativePath = new URL(url).pathname.replace(basePath, '');
    const filePath = path.join(config.storage.localDir, relativePath);
    try {
      return await readFile(filePath);
    } catch (error) {
      logger.error('Failed to read file from local storage', { filePath, error });
      throw new AppError('Failed to download file', 500, 'STORAGE_ERROR');
    }
  }

  const key = url.replace(`${config.r2.publicUrl}/`, '');
  try {
    const response = await s3Client!.send(
      new GetObjectCommand({
        Bucket: config.r2.bucketName,
        Key: key,
      }),
    );

    const stream = response.Body;
    if (!stream) {
      throw new Error('Empty response body');
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  } catch (error) {
    logger.error('Failed to download file from R2', { key, error });
    throw new AppError('Failed to download file', 500, 'STORAGE_ERROR');
  }
}

/**
 * Generate a pre-signed URL for temporary direct access to a file (R2 only).
 */
export async function getPresignedUrl(url: string, expiresIn: number = 3600): Promise<string> {
  if (config.storage.mode === 'local') {
    // Local files are directly accessible via static server
    return url;
  }

  const key = url.replace(`${config.r2.publicUrl}/`, '');
  try {
    const signedUrl = await getSignedUrl(
      s3Client!,
      new GetObjectCommand({
        Bucket: config.r2.bucketName,
        Key: key,
      }),
      { expiresIn },
    );

    return signedUrl;
  } catch (error) {
    logger.error('Failed to generate presigned URL', { key, error });
    throw new AppError('Failed to generate download link', 500, 'STORAGE_ERROR');
  }
}
