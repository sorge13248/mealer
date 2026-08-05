import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  computeOcrTextQualityScore,
  normalizeOcrOutputText,
} from './receipt-ocr-text.utils';
import { ReceiptOcrProvider } from './receipt-ocr-provider.interface';
import { SelfHostedHttpReceiptOcrProvider } from './self-hosted-http-receipt-ocr.provider';
import { TesseractReceiptOcrProvider } from './tesseract-receipt-ocr.provider';

const OCR_ACCEPTABLE_TEXT_SCORE = 0.72;

@Injectable()
export class ReceiptOcrEngineService {
  private readonly logger = new Logger(ReceiptOcrEngineService.name);

  constructor(
    private readonly selfHostedProvider: SelfHostedHttpReceiptOcrProvider,
    private readonly tesseractProvider: TesseractReceiptOcrProvider,
  ) {}

  normalizeOcrOutputText(rawText: string): string {
    return normalizeOcrOutputText(rawText);
  }

  computeOcrTextQualityScore(text: string): number {
    return computeOcrTextQualityScore(text);
  }

  async extractTextWithOcr(buffer: Buffer): Promise<string> {
    // Try providers in configured order; keep best text and short-circuit on high score.
    const providers = this.getProvidersInPriorityOrder();
    this.logger.log(
      `ocr.start bytes=${buffer.length} providers=${providers
        .map((provider) => provider.providerName)
        .join('>')}`,
    );

    let bestText = '';
    let bestScore = -1;
    let bestProviderName = 'none';
    let hadProviderErrors = false;

    for (const provider of providers) {
      try {
        const rawText = await provider.extractText(buffer);
        const normalizedText = this.normalizeOcrOutputText(rawText);
        const score = this.computeOcrTextQualityScore(normalizedText);

        this.logger.log(
          `ocr.provider.success provider=${provider.providerName} score=${score.toFixed(4)} textLen=${normalizedText.length}`,
        );

        if (score > bestScore) {
          bestScore = score;
          bestText = normalizedText;
          bestProviderName = provider.providerName;
        }

        if (score >= OCR_ACCEPTABLE_TEXT_SCORE) {
          this.logger.log(
            `ocr.provider.accepted provider=${provider.providerName} score=${score.toFixed(4)}`,
          );
          return normalizedText;
        }
      } catch (error) {
        hadProviderErrors = true;
        const message =
          error instanceof Error ? error.message : 'unexpected provider error';
        this.logger.warn(
          `ocr.provider.error provider=${provider.providerName} reason=${message}`,
        );
        continue;
      }
    }

    if (bestText) {
      this.logger.warn(
        `ocr.best-effort provider=${bestProviderName} score=${bestScore.toFixed(4)} textLen=${bestText.length}`,
      );
      return bestText;
    }

    if (hadProviderErrors) {
      this.logger.error('ocr.failed all providers errored');
      throw new BadRequestException(
        'OCR non riuscito: nessun provider locale ha riconosciuto il testo.',
      );
    }

    this.logger.error('ocr.failed no usable text and no provider errors');
    throw new BadRequestException(
      'OCR non riuscito: immagine non leggibile o provider non configurati.',
    );
  }

  private getProvidersInPriorityOrder(): ReceiptOcrProvider[] {
    const providersByName = new Map<string, ReceiptOcrProvider>([
      ['selfhosted-http', this.selfHostedProvider],
      ['tesseract', this.tesseractProvider],
    ]);

    const orderFromEnv = (
      process.env.OCR_PROVIDER_ORDER ?? 'selfhosted-http,tesseract'
    )
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);

    const orderedProviders: ReceiptOcrProvider[] = [];
    for (const providerName of orderFromEnv) {
      const provider = providersByName.get(providerName);
      if (!provider) {
        continue;
      }

      if (orderedProviders.includes(provider)) {
        continue;
      }

      orderedProviders.push(provider);
    }

    if (!orderedProviders.includes(this.tesseractProvider)) {
      // Always keep local Tesseract as final fallback.
      orderedProviders.push(this.tesseractProvider);
    }

    return orderedProviders;
  }
}
