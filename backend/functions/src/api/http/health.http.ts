import { onRequest } from 'firebase-functions/v2/https';
import { REGION } from '../../core/env';

/**
 * Health check endpoint
 * GET /health
 */
export const health = onRequest(
  {
    region: REGION,
    memory: '256MiB',
    timeoutSeconds: 10,
  },
  (_req, res) => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.0.1',
    });
  }
);
