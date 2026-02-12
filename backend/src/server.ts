import app from './app';
import { config, validateEnv } from './config';
import { connectDatabase, disconnectDatabase } from './utils/prisma';
import { disconnectRedis } from './queue/connection';
import { startReportWorker, stopReportWorker } from './queue/report.worker';
import { logger } from './utils/logger';

async function bootstrap(): Promise<void> {
  try {
    // Validate environment variables
    validateEnv();

    // Connect to database
    await connectDatabase();

    // Start BullMQ worker for report generation
    startReportWorker();

    // Start HTTP server
    const server = app.listen(config.port, () => {
      logger.info(`ReportAI server running on port ${config.port}`, {
        env: config.env,
        port: config.port,
      });
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);

      server.close(async () => {
        logger.info('HTTP server closed');

        await stopReportWorker();
        await disconnectRedis();
        await disconnectDatabase();

        logger.info('Graceful shutdown complete');
        process.exit(0);
      });

      // Force shutdown after 15s
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 15_000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    process.on('unhandledRejection', (reason: unknown) => {
      logger.error('Unhandled rejection', { reason });
    });

    process.on('uncaughtException', (error: Error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      process.exit(1);
    });
  } catch (error) {
    logger.error('Failed to start ReportAI server', { error });
    process.exit(1);
  }
}

bootstrap();
