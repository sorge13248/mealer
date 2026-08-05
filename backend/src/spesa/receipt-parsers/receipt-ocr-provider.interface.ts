export interface ReceiptOcrProvider {
  readonly providerName: string;
  extractText(buffer: Buffer): Promise<string>;
}
