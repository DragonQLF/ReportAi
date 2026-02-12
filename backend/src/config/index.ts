import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  isProduction: process.env.NODE_ENV === 'production',
  baseUrl: process.env.BASE_URL || 'http://localhost:4000',

  database: {
    url: process.env.DATABASE_URL!,
  },

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID!,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  },

  gemini: {
    apiKey: process.env.GEMINI_API_KEY!,
  },

  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  r2: {
    accountId: process.env.R2_ACCOUNT_ID!,
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    bucketName: process.env.R2_BUCKET_NAME || 'reportai-screenshots',
    publicUrl: process.env.R2_PUBLIC_URL!,
  },

  storage: {
    mode: (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID) ? 'r2' : 'local' as 'r2' | 'local',
    localDir: path.join(process.cwd(), 'data', 'uploads'),
    localPublicUrl: process.env.LOCAL_STORAGE_URL || 'http://localhost:4000/uploads',
  },

  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY!,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
  },

  frontend: {
    url: process.env.FRONTEND_URL || 'http://localhost:3000',
  },
} as const;

/** Validate that all required environment variables are set */
export function validateEnv(): void {
  const always = ['DATABASE_URL', 'BETTER_AUTH_SECRET'];
  const productionOnly = ['GEMINI_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'FRONTEND_URL'];
  const r2Required = (process.env.R2_ACCOUNT_ID || process.env.R2_ACCESS_KEY_ID)
    ? ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_PUBLIC_URL']
    : [];

  const required = [
    ...always,
    ...(process.env.NODE_ENV === 'production' ? productionOnly : []),
    ...r2Required,
  ];

  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}
