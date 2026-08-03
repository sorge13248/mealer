declare module 'tesseract.js' {
  export interface TesseractRecognizeResult {
    data: {
      text: string;
    };
  }

  export interface TesseractWorker {
    recognize(image: Buffer | Uint8Array | string): Promise<TesseractRecognizeResult>;
    terminate(): Promise<void>;
  }

  export function createWorker(languages?: string): Promise<TesseractWorker>;
}
