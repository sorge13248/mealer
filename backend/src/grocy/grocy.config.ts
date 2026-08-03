import { InternalServerErrorException } from '@nestjs/common';

export interface GrocyConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 10000;

function getRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new InternalServerErrorException(
      `Missing required environment variable: ${name}`,
    );
  }

  return value;
}

export function readGrocyConfigFromEnv(): GrocyConfig {
  const baseUrl = getRequiredEnv('GROCY_BASE_URL').replace(/\/+$/, '');
  const apiKey = getRequiredEnv('GROCY_API_KEY');
  const timeoutValue = process.env.GROCY_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutValue ? Number(timeoutValue) : DEFAULT_TIMEOUT_MS;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new InternalServerErrorException(
      'GROCY_TIMEOUT_MS must be a positive number',
    );
  }

  return {
    baseUrl,
    apiKey,
    timeoutMs,
  };
}
