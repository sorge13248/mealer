import { BadRequestException, Injectable } from '@nestjs/common';
import { ReceiptParsingDispatchResult } from './receipt-parser.types';

interface PdfParseInstance {
  getText: () => Promise<{ text?: string }>;
  destroy?: () => Promise<void>;
}

interface PdfParseV2Constructor {
  new (options: { data: Buffer | Uint8Array }): PdfParseInstance;
}

interface PdfParseModule {
  default?:
    ((input: Buffer) => Promise<{ text?: string }>) | PdfParseV2Constructor;
  PDFParse?: PdfParseV2Constructor;
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
      const pdfModule =
        (await import('pdf-parse')) as unknown as PdfParseModule;
      if (pdfModule.PDFParse) {
        const parser = new pdfModule.PDFParse({ data: buffer });
        try {
          const parsed = await parser.getText();
          const text = typeof parsed?.text === 'string' ? parsed.text : '';
          return this.normalizeText(text);
        } finally {
          if (parser.destroy) {
            await parser.destroy();
          }
        }
      }

      if (typeof pdfModule.default === 'function') {
        const parsed = await (
          pdfModule.default as (input: Buffer) => Promise<{ text?: string }>
        )(buffer);
        const text = typeof parsed?.text === 'string' ? parsed.text : '';
        return this.normalizeText(text);
      }

      return '';
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
