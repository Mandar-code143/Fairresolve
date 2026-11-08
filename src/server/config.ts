/**
 * FairResolve Configuration Loader
 * Ensures .env is loaded before any singleton services initialize.
 */

import dotenv from 'dotenv';
import path from 'path';

// Load .env explicitly from root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

export const config = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  DATABASE_URL: process.env.DATABASE_URL || '',
  DEMO_MODE: process.env.DEMO_MODE === 'true',
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID || '',
  PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET || '',
  PAYPAL_ENVIRONMENT: (process.env.PAYPAL_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
  PAYPAL_LIVE_ENABLED: process.env.PAYPAL_LIVE_ENABLED === 'true',
  PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID || 'WH-SANDBOX-DEFAULT',
  RUN_IN_PROCESS_WORKER: process.env.RUN_IN_PROCESS_WORKER !== 'false',
  SERVICE_TYPE: process.env.SERVICE_TYPE || 'app',
  SESSION_SECRET: process.env.SESSION_SECRET || 'fairresolve-secure-session-salt-2026',
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://127.0.0.1:5173'],
};

export default config;
