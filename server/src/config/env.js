import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_ENV = path.resolve(__dirname, '../../.env');
const ROOT_ENV = path.resolve(__dirname, '../../../.env');

// Load .env from server/.env or project root .env regardless of process.cwd()
for (const envPath of [SERVER_ENV, ROOT_ENV]) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

if (!process.env.GITHUB_TOKEN && process.env.GITHUB_PAT) {
  process.env.GITHUB_TOKEN = process.env.GITHUB_PAT;
}

