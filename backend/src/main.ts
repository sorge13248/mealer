import './load-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

function parseAllowedOrigins(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((origin): origin is string => typeof origin === 'string')
        .map((origin) => origin.trim())
        .filter(Boolean);
    }
  } catch {
    // Fallback to comma-separated list when value is not JSON.
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const corsOrigins = parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : false,
    credentials: true,
  });

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
