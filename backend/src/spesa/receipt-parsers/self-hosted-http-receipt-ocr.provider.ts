import { Injectable, Logger } from '@nestjs/common';
import { ReceiptOcrProvider } from './receipt-ocr-provider.interface';

interface SelfHostedOcrResponse {
  engine?: unknown;
  score?: unknown;
  lines?: unknown;
  text?: unknown;
}

const DEFAULT_OCR_HTTP_URL = 'http://mealer-ocr:8000/ocr/receipt/base64';
const DEFAULT_OCR_HTTP_TIMEOUT_MS = 45000;

@Injectable()
export class SelfHostedHttpReceiptOcrProvider implements ReceiptOcrProvider {
  readonly providerName = 'selfhosted-http';
  private readonly logger = new Logger(SelfHostedHttpReceiptOcrProvider.name);

  async extractText(buffer: Buffer): Promise<string> {
    if (!this.isEnabled()) {
      throw new Error('Self-hosted OCR provider disabled by configuration.');
    }

    this.logger.log(
      `ocr-http.start url=${this.getServiceUrl()} bytes=${buffer.length}`,
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.getTimeoutMs());

    try {
      const response = await fetch(this.getServiceUrl(), {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ imageBase64: buffer.toString('base64') }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = (await response.json()) as SelfHostedOcrResponse;
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';

      this.logger.log(
        `ocr-http.end engine=${String(payload.engine ?? 'unknown')} score=${String(payload.score ?? 'n/a')} lines=${String(payload.lines ?? 'n/a')} textLen=${text.length}`,
      );

      if (!text) {
        throw new Error('Self-hosted OCR provider returned empty text.');
      }

      return text;
    } finally {
      clearTimeout(timeout);
    }
  }

  private isEnabled(): boolean {
    const raw = process.env.OCR_HTTP_ENABLED;
    if (raw === undefined) {
      return true;
    }

    return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
  }

  private getServiceUrl(): string {
    const raw = process.env.OCR_HTTP_URL?.trim();
    return raw || DEFAULT_OCR_HTTP_URL;
  }

  private getTimeoutMs(): number {
    const parsed = Number(process.env.OCR_HTTP_TIMEOUT_MS ?? '');
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }

    return DEFAULT_OCR_HTTP_TIMEOUT_MS;
  }
}
