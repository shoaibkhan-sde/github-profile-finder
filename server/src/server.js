import './config/env.js';
import { app } from './app.js';
import { logger } from './utils/logger.js';

const PORT = parseInt(process.env.PORT, 10) || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Validate environment settings
const hasToken = process.env.GITHUB_TOKEN &&
  process.env.GITHUB_TOKEN !== 'your_github_personal_access_token_here' &&
  process.env.GITHUB_TOKEN.trim().length > 0;

if (hasToken) {
  logger.info('GitHub Personal Access Token detected (Authenticated Mode: 5,000 req/hr + GraphQL enabled).');
} else {
  logger.info('No GitHub token detected. Running in Unauthenticated Mode (60 req/hr IP limit).');
}

const server = app.listen(PORT, () => {
  logger.info(`GitHub Profile Finder Server running in ${NODE_ENV} mode on http://localhost:${PORT}`);
});

// Graceful Shutdown
function handleShutdown(signal) {
  logger.info(`Received ${signal}. Gracefully shutting down HTTP server...`);
  server.close(() => {
    logger.info('HTTP server closed cleanly.');
    process.exit(0);
  });

  // Force close if graceful shutdown takes too long
  setTimeout(() => {
    logger.error('Forcefully terminating process after shutdown timeout.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

