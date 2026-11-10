/**
 * FairResolve Configuration Loader
 * Ensures .env is loaded before any singleton services initialize.
 */

import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';

// Load .env explicitly from root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

const nodeEnv = process.env.NODE_ENV || 'development';
const isProd = nodeEnv === 'production';

let resolvedSessionSecret = process.env.SESSION_SECRET || '';
if (!resolvedSessionSecret) {
  if (isProd) {
    resolvedSessionSecret = crypto.randomBytes(32).toString('hex');
    console.warn('[Config] WARNING: SESSION_SECRET env var not set in production; generated ephemeral runtime secret.');
  } else {
    resolvedSessionSecret = 'fairresolve-dev-session-secret';
  }
}

const defaultAllowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const rawAllowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [...defaultAllowedOrigins];

const derivedRailwayUrl = process.env.RAILWAY_PUBLIC_DOMAIN
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`
  : '';

const appBaseUrl = process.env.APP_BASE_URL
  ? process.env.APP_BASE_URL.replace(/\/+$/, '')
  : derivedRailwayUrl || `http://localhost:${process.env.PORT || 3000}`;

for (const candidateUrl of [process.env.APP_BASE_URL, derivedRailwayUrl].filter(Boolean) as string[]) {
  try {
    const origin = new URL(candidateUrl).origin;
    if (!rawAllowedOrigins.includes(origin)) {
      rawAllowedOrigins.push(origin);
    }
  } catch (_) {
    if (!rawAllowedOrigins.includes(candidateUrl)) {
      rawAllowedOrigins.push(candidateUrl);
    }
  }
}

export const config = {
  NODE_ENV: nodeEnv,
  PORT: process.env.PORT ? parseInt(process.env.PORT, 10) : 3000,
  DATABASE_URL: process.env.DATABASE_URL || '',
  DEMO_MODE: process.env.DEMO_MODE !== 'false',
  FAIRRESOLVE_STORAGE_DIR: process.env.FAIRRESOLVE_STORAGE_DIR
    ? path.resolve(process.env.FAIRRESOLVE_STORAGE_DIR)
    : '',
  APP_BASE_URL: appBaseUrl,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || '',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID || '',
  PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET || '',
  PAYPAL_ENVIRONMENT: (process.env.PAYPAL_ENVIRONMENT || 'sandbox') as 'sandbox' | 'production',
  PAYPAL_LIVE_ENABLED: process.env.PAYPAL_LIVE_ENABLED === 'true',
  PAYPAL_WEBHOOK_ID: process.env.PAYPAL_WEBHOOK_ID || '',
  RUN_IN_PROCESS_WORKER: process.env.RUN_IN_PROCESS_WORKER !== 'false',
  SERVICE_TYPE: process.env.SERVICE_TYPE || 'app',
  SESSION_SECRET: resolvedSessionSecret,
  ALLOWED_ORIGINS: rawAllowedOrigins,
};

export default config;
