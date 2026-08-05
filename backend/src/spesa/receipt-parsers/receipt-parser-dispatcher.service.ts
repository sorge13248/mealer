import { Injectable, Logger } from '@nestjs/common';
import { AdobeScanPdfReceiptParserService } from './adobe-scan-pdf-receipt-parser.service';
import { CoopOfficialPdfReceiptParserService } from './coop-official-pdf-receipt-parser.service';
import {
  ReceiptParserKind,
  ReceiptParsingDispatchResult,
} from './receipt-parser.types';
import { PhotoReceiptParserService } from './photo-receipt-parser.service';

const PDF_MIN_MEANINGFUL_LINES = 6;

@Injectable()
export class ReceiptParserDispatcherService {
  private readonly logger = new Logger(ReceiptParserDispatcherService.name);

  constructor(
    private readonly coopOfficialPdfParser: CoopOfficialPdfReceiptParserService,
    private readonly adobeScanPdfParser: AdobeScanPdfReceiptParserService,
    private readonly photoParser: PhotoReceiptParserService,
  ) {}

  async parse(
    file: Express.Multer.File,
  ): Promise<ReceiptParsingDispatchResult> {
    // Route by media type first, then pick the most reliable PDF strategy.
    const mimeType = (file.mimetype ?? '').toLowerCase();
    const isPdf =
      mimeType.includes('pdf') ||
      file.originalname.toLowerCase().endsWith('.pdf');
    const isImage = mimeType.startsWith('image/');

    this.logger.log(
      `dispatch.start file=${file.originalname} mime=${file.mimetype} isPdf=${isPdf} isImage=${isImage}`,
    );

    if (isImage) {
      this.logger.log('dispatch.route photoParser');
      return this.photoParser.parse(file.buffer);
    }

    if (!isPdf) {
      // Should already be blocked by controller-level validation.
      this.logger.warn('dispatch.route non-pdf fallback photoParser');
      return this.photoParser.parse(file.buffer);
    }

    const preferredKind = await this.detectPdfParserKind(file.buffer);
    this.logger.log(`dispatch.preferredKind ${preferredKind}`);

    if (preferredKind === 'adobe-scan-pdf') {
      // Prefer Adobe pipeline, but gracefully fallback to text-layer parser.
      try {
        this.logger.log('dispatch.try adobeScanPdfParser');
        return await this.adobeScanPdfParser.parse(file.buffer);
      } catch {
        this.logger.warn(
          'dispatch.fallback coopOfficialPdfParser after adobe failure',
        );
        return this.coopOfficialPdfParser.parse(file.buffer);
      }
    }

    try {
      // Prefer official PDF parser for structured text-layer receipts.
      this.logger.log('dispatch.try coopOfficialPdfParser');
      return await this.coopOfficialPdfParser.parse(file.buffer);
    } catch {
      this.logger.warn(
        'dispatch.fallback adobeScanPdfParser after coop failure',
      );
      return this.adobeScanPdfParser.parse(file.buffer);
    }
  }

  private async detectPdfParserKind(
    buffer: Buffer,
  ): Promise<ReceiptParserKind> {
    // Fast metadata/text heuristics to avoid expensive OCR when unnecessary.
    if (this.looksLikeAdobeScanPdf(buffer)) {
      return 'adobe-scan-pdf';
    }

    const textLayer = await this.coopOfficialPdfParser.extractTextLayer(buffer);
    const meaningfulLines = this.countMeaningfulLines(textLayer);

    if (meaningfulLines < PDF_MIN_MEANINGFUL_LINES) {
      return 'adobe-scan-pdf';
    }

    if (this.looksLikeCoopOfficialText(textLayer)) {
      return 'coop-official-pdf';
    }

    // Non-Adobe PDFs with reasonable text are treated as official PDF flow.
    return 'coop-official-pdf';
  }

  private looksLikeAdobeScanPdf(buffer: Buffer): boolean {
    // Adobe Scan typically leaves identifiable producer markers in the PDF body.
    const binaryText = buffer.toString('latin1');
    return /Adobe\s*Scan|\/Producer\s*\((?:[^)]*Adobe[^)]*Scan[^)]*)\)/i.test(
      binaryText,
    );
  }

  private looksLikeCoopOfficialText(text: string): boolean {
    if (!text) {
      return false;
    }

    return (
      /\bCOOP\b|COOP\s*ALLEANZA|ALLEANZA\s*3\.0/i.test(text) &&
      /DOCUMENTO\s+COMMERCIALE|DESCRIZIONE|TOTALE/i.test(text)
    );
  }

  private countMeaningfulLines(text: string): number {
    // Distinguish useful text-layer receipts from collapsed or near-empty layers.
    if (!text) {
      return 0;
    }

    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length >= 2).length;
  }
}
