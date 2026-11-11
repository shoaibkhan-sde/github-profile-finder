import './config/env.js';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { apiRouter } from './routes/api.js';
import { errorHandler } from './middleware/errorHandler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CLIENT_DIR = path.resolve(__dirname, '../../client');

export function createApp() {
  const instance = express();
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const allowedOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:3000';

  // Trust reverse proxy for deployment platforms (Render, Vercel, Railway)
  instance.set('trust proxy', 1);

  // Security Headers with Helmet
  instance.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          imgSrc: ["'self'", 'data:', 'https://avatars.githubusercontent.com', 'https://github.com'],
          connectSrc: ["'self'", 'https://api.github.com'],
          objectSrc: ["'none'"],
          upgradeInsecureRequests: isProduction && allowedOrigin.startsWith('https://') ? [] : null
        }
      },
      crossOriginEmbedderPolicy: false
    })
  );

  // CORS Allowlist Configuration (allows same-host module/API requests & explicit allowlist in production)
  instance.use(
    cors((req, callback) => {
      const origin = req.header('Origin');
      const host = req.header('Host');
      let isSameHost = false;
      if (origin && host) {
        try {
          isSameHost = new URL(origin).host === host;
        } catch {
          isSameHost = false;
        }
      }

      if (!origin || origin === allowedOrigin || isSameHost || !isProduction) {
        return callback(null, {
          origin: true,
          methods: ['GET', 'HEAD'],
          allowedHeaders: ['Content-Type', 'Accept'],
          credentials: false
        });
      }
      const corsErr = new Error('CORS policy: Access denied for this origin.');
      corsErr.status = 403;
      corsErr.name = 'CorsError';
      return callback(corsErr);
    })
  );

  // Rate Limiter: max 60 requests per window (1 minute) per IP
  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 60000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'TooManyRequests',
      message: 'Too many requests from this IP. Please try again in one minute.'
    }
  });

  // JSON Body Parser
  instance.use(express.json({ limit: '10kb' }));

  // Mount API routes with Rate Limiter
  instance.use('/api', limiter, apiRouter);

  // JSON 404 fallback for unknown /api routes or unsupported methods
  instance.use('/api', (_req, res) => {
    res.status(404).json({
      error: 'NotFoundError',
      message: 'API endpoint not found.'
    });
  });

  // Serve Static Frontend Assets (no aggressive cache in dev so UI edits reflect immediately)
  instance.use(express.static(CLIENT_DIR, { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0, etag: true }));

  // Client Fallback for SPA routing
  instance.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(CLIENT_DIR, 'index.html'));
  });

  // Central Error Handler
  instance.use(errorHandler);

  return instance;
}

export const app = createApp();

