import { Worker, Job } from 'bullmq';
import { redis } from './connection';
import { runPipeline } from '../pipeline';
import { logger } from '../utils/logger';
import type { ReportJobData } from './report.queue';

let worker: Worker<ReportJobData> | null = null;

export function startReportWorker(): Worker<ReportJobData> {
  worker = new Worker<ReportJobData>(
    'report-generation',
    async (job: Job<ReportJobData>) => {
      logger.info('Processing report job', {
        reportId: job.data.reportId,
        userId: job.data.userId,
        jobId: job.id,
      });

      await runPipeline(job.data.reportId);
    },
    {
      connection: redis,
      concurrency: 2,
    },
  );

  worker.on('completed', (job) => {
    logger.info('Report job completed', {
      reportId: job.data.reportId,
      jobId: job.id,
    });
  });

  worker.on('failed', (job, error) => {
    logger.error('Report job failed', {
      reportId: job?.data.reportId,
      jobId: job?.id,
      error: error.message,
    });
  });

  logger.info('Report worker started');
  return worker;
}

export async function stopReportWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    logger.info('Report worker stopped');
  }
}
