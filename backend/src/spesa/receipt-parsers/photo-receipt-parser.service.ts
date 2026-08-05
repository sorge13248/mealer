import { Injectable } from '@nestjs/common';
import { ReceiptOcrEngineService } from './receipt-ocr-engine.service';
import { ReceiptParsingDispatchResult } from './receipt-parser.types';

@Injectable()
export class PhotoReceiptParserService {
  constructor(private readonly ocrEngine: ReceiptOcrEngineService) {}

  async parse(buffer: Buffer): Promise<ReceiptParsingDispatchResult> {
    // Photo uploads always go through OCR pipeline.
    const rawText = await this.ocrEngine.extractTextWithOcr(buffer);
    return {
      kind: 'photo',
      source: 'ocr',
      rawText,
    };
  }
}
