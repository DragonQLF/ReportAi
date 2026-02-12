import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { toNodeHandler } from 'better-auth/node';
import { config } from './config';
import { auth } from './auth';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { logger } from './utils/logger';

// Route imports
import reportRoutes from './routes/report.routes';
import uploadRoutes from './routes/upload.routes';
import chatRoutes from './routes/chat.routes';

const app = express();

// --- Security middleware ---
app.use(helmet());
app.use(
  cors({
    origin: config.frontend.url,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['X-Report-Id'],
  }),
);

// --- Rate limiting ---
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests, please try again later',
    },
  },
});
app.use('/api/', limiter);

// --- Local storage static file serving ---
if (config.storage.mode === 'local') {
  app.use('/uploads', (_req, res, next) => {
    // Allow cross-origin image loading from the frontend
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  }, express.static(path.join(process.cwd(), 'data', 'uploads')));
}

// --- Body parsing & cookies ---
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(compression());

// --- Better Auth (handles /api/auth/* routes) ---
app.all('/api/auth/*splat', toNodeHandler(auth));

// --- Request logging ---
app.use((req, _res, next) => {
  logger.debug(`${req.method} ${req.path}`, {
    ip: req.ip,
    userAgent: req.get('User-Agent')?.substring(0, 80),
  });
  next();
});

// --- Health check ---
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'reportai',
    timestamp: new Date().toISOString(),
  });
});

// --- API routes ---
app.use('/api/reports', reportRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/chat', chatRoutes);

// --- Error handling ---
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
