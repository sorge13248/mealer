import { BadRequestException, Injectable } from '@nestjs/common';
import { ReceiptParsingDispatchResult } from './receipt-parser.types';

interface PdfParseResult {
  text?: string;
}

interface PdfParseModule {
  default: (input: Buffer) => Promise<PdfParseResult>;
}

@Injectable()
export class CoopOfficialPdfReceiptParserService {
  async parse(buffer: Buffer): Promise<ReceiptParsingDispatchResult> {
    // Official PDF receipts are expected to expose an already searchable text layer.
    const text = await this.extractTextLayer(buffer);
    if (!text) {
      throw new BadRequestException(
        'PDF Coop senza testo leggibile nel livello testuale.',
      );
    }

    return {
      kind: 'coop-official-pdf',
      source: 'pdf',
      rawText: text,
    };
  }

  async extractTextLayer(buffer: Buffer): Promise<string> {
    // Parse embedded textual content without OCR for speed and fidelity.
    try {
      const pdfModuleCandidate: unknown = await import('pdf-parse');
      const pdfModule = pdfModuleCandidate as PdfParseModule;
      const parsed = await pdfModule.default(buffer);
      const text = typeof parsed.text === 'string' ? parsed.text : '';
      return this.normalizeText(text);
    } catch {
      return '';
    }
  }

  private normalizeText(rawText: string): string {
    return rawText
      .replace(/\u00a0/g, ' ')
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .trim();
  }
}
