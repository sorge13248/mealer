import {
  BadRequestException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import { ReceiptOcrProvider } from './receipt-ocr-provider.interface';
import {
  computeOcrTextQualityScore,
  normalizeOcrOutputText,
} from './receipt-ocr-text.utils';

interface OcrWorker {
  recognize(
    image: Buffer,
    options?: { rotateAuto?: boolean },
  ): Promise<{ data: { text: string } }>;
  setParameters(parameters: Record<string, string | number>): Promise<void>;
  terminate(): Promise<void>;
}

const OCR_ACCEPTABLE_TEXT_SCORE = 0.72;
const OCR_MIN_DIMENSION_PX = 3;
const OCR_TARGET_MIN_WIDTH_PX = 2200;

@Injectable()
export class TesseractReceiptOcrProvider
  implements ReceiptOcrProvider, OnModuleDestroy
{
  readonly providerName = 'tesseract';

  private ocrWorker: OcrWorker | null = null;
  private ocrWorkerSetupPromise: Promise<OcrWorker> | null = null;
  private ocrQueue: Promise<void> = Promise.resolve();

  async onModuleDestroy(): Promise<void> {
    if (!this.ocrWorker) {
      return;
    }

    await this.ocrWorker.terminate();
    this.ocrWorker = null;
    this.ocrWorkerSetupPromise = null;
    this.ocrQueue = Promise.resolve();
  }

  async extractText(buffer: Buffer): Promise<string> {
    // Try multiple preprocessing/page-segmentation strategies and keep best result.
    const imageVariants = await this.prepareReceiptImageVariants(buffer);

    return this.runOcrJob(async (worker) => {
      const attempts: Array<{ image: Buffer; pageSegMode: number }> = [
        { image: imageVariants[0], pageSegMode: 3 },
        { image: imageVariants[0], pageSegMode: 6 },
        { image: imageVariants[1] ?? imageVariants[0], pageSegMode: 6 },
        {
          image: imageVariants[2] ?? imageVariants[1] ?? imageVariants[0],
          pageSegMode: 4,
        },
        {
          image:
            imageVariants[3] ??
            imageVariants[2] ??
            imageVariants[1] ??
            imageVariants[0],
          pageSegMode: 11,
        },
        {
          image:
            imageVariants[3] ??
            imageVariants[2] ??
            imageVariants[1] ??
            imageVariants[0],
          pageSegMode: 12,
        },
      ];

      let bestText = '';
      let bestScore = -1;
      let hadEngineErrors = false;

      for (const attempt of attempts) {
        try {
          await worker.setParameters({
            tessedit_pageseg_mode: attempt.pageSegMode,
            preserve_interword_spaces: 1,
          });

          const resultCandidate: unknown = await worker.recognize(
            attempt.image,
            {
              rotateAuto: true,
            },
          );
          const result = resultCandidate as { data: { text: string } };
          const normalizedText = normalizeOcrOutputText(result.data.text);
          const score = computeOcrTextQualityScore(normalizedText);

          if (score > bestScore) {
            bestScore = score;
            bestText = normalizedText;
          }

          if (score >= OCR_ACCEPTABLE_TEXT_SCORE) {
            break;
          }
        } catch {
          hadEngineErrors = true;
          continue;
        }
      }

      if (!bestText) {
        if (hadEngineErrors) {
          throw new BadRequestException(
            'OCR non riuscito: impossibile riconoscere il testo nello scontrino.',
          );
        }

        throw new BadRequestException(
          'OCR non riuscito: immagine non leggibile o di qualita insufficiente.',
        );
      }

      return bestText;
    });
  }

  private async prepareReceiptImageVariants(buffer: Buffer): Promise<Buffer[]> {
    // Build image variants tuned for low-contrast receipts photographed by phone.
    try {
      type JimpImage = {
        getWidth(): number;
        getHeight(): number;
        resize(width: number, height: number): JimpImage;
        grayscale(): JimpImage;
        contrast(value: number): JimpImage;
        normalize(): JimpImage;
        posterize(levels: number): JimpImage;
        clone(): JimpImage;
        getBuffer(mime: string): Promise<Buffer>;
      };

      const jimpModuleCandidate: unknown = await import('jimp');
      const jimpModule = jimpModuleCandidate as {
        Jimp?: {
          read(input: Buffer): Promise<JimpImage>;
        };
      };

      const Jimp = jimpModule.Jimp;
      if (!Jimp?.read) {
        return [buffer];
      }

      const sourceImage = await Jimp.read(buffer);
      const sourceWidth = sourceImage.getWidth();
      const sourceHeight = sourceImage.getHeight();

      if (
        sourceWidth < OCR_MIN_DIMENSION_PX ||
        sourceHeight < OCR_MIN_DIMENSION_PX
      ) {
        throw new BadRequestException(
          'Immagine non valida: risoluzione troppo piccola per OCR.',
        );
      }

      const normalizedImage = sourceImage.clone();

      const resizeRatio = Math.max(
        1,
        OCR_TARGET_MIN_WIDTH_PX / Math.max(normalizedImage.getWidth(), 1),
      );
      if (resizeRatio > 1) {
        normalizedImage.resize(
          Math.round(normalizedImage.getWidth() * resizeRatio),
          Math.round(normalizedImage.getHeight() * resizeRatio),
        );
      }

      normalizedImage.grayscale().contrast(0.32).normalize();

      const highContrastImage = normalizedImage.clone();
      highContrastImage.contrast(0.45);

      const posterizedImage = normalizedImage.clone();
      posterizedImage.posterize(3).contrast(0.5);

      const originalPng = await sourceImage.getBuffer('image/png');
      const normalizedPng = await normalizedImage.getBuffer('image/png');
      const highContrastPng = await highContrastImage.getBuffer('image/png');
      const posterizedPng = await posterizedImage.getBuffer('image/png');

      return [originalPng, normalizedPng, highContrastPng, posterizedPng];
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      return [buffer];
    }
  }

  private async runOcrJob<T>(
    job: (worker: OcrWorker) => Promise<T>,
  ): Promise<T> {
    // Serialize OCR jobs because one Tesseract worker is reused across requests.
    const previousQueue = this.ocrQueue;
    let releaseQueue!: () => void;
    this.ocrQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previousQueue;

    try {
      const worker = await this.getOrCreateOcrWorker();
      return await job(worker);
    } finally {
      releaseQueue();
    }
  }

  private async getOrCreateOcrWorker(): Promise<OcrWorker> {
    // Lazy worker initialization keeps startup fast and avoids redundant workers.
    if (this.ocrWorker) {
      return this.ocrWorker;
    }

    if (!this.ocrWorkerSetupPromise) {
      this.ocrWorkerSetupPromise = (async () => {
        const workerCandidate: unknown = await createWorker(
          'ita+eng',
          undefined,
          undefined,
          {
            load_system_dawg: '0',
            load_freq_dawg: '0',
            user_words_suffix: '',
          },
        );
        const worker = workerCandidate as OcrWorker;

        await worker.setParameters({
          tessedit_pageseg_mode: 6,
          preserve_interword_spaces: 1,
          user_defined_dpi: 300,
        });

        this.ocrWorker = worker;
        return worker;
      })();
    }

    try {
      return await this.ocrWorkerSetupPromise;
    } catch (error) {
      this.ocrWorkerSetupPromise = null;
      throw error;
    }
  }
}
