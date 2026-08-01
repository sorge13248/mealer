import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

const parentEnvPath = resolve(process.cwd(), '../.env');

if (existsSync(parentEnvPath)) {
  loadDotenv({ path: parentEnvPath });
}

loadDotenv();
