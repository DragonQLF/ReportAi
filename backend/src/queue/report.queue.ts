import { Queue } from 'bullmq';
import { redis } from './connection';

export interface ReportJobData {
  reportId: string;
  userId: string;
}

export const reportQueue = new Queue<ReportJobData>('report-generation', {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
    attempts: 1,
  },
});
