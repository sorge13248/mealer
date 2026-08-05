export type ReceiptParserKind =
  'coop-official-pdf' | 'adobe-scan-pdf' | 'photo';

export interface ReceiptParsingDispatchResult {
  kind: ReceiptParserKind;
  source: 'pdf' | 'ocr';
  rawText: string;
}
