import { Router } from 'express';
import {
  getProfile,
  getUserRepositories,
  getUserStarred,
  getContributions,
  getRateLimit,
  getHealth
} from '../controllers/profileController.js';
import { validateUsername } from '../middleware/validator.js';

export const apiRouter = Router();

// Health check endpoint
apiRouter.get('/health', getHealth);

// GitHub Rate Limit Status endpoint
apiRouter.get('/rate-limit', getRateLimit);

// Primary Profile Retrieval endpoint with strict validation
apiRouter.get('/profile/:username', validateUsername, getProfile);

// On-demand paginated public repositories endpoint
apiRouter.get('/repos/:username', validateUsername, getUserRepositories);

// On-demand paginated starred repositories endpoint
apiRouter.get('/starred/:username', validateUsername, getUserStarred);

// Live current-year contributions endpoint (bypasses stale profile cache)
apiRouter.get('/contributions/:username', validateUsername, getContributions);

