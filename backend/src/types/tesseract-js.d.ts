declare module 'tesseract.js' {
  export interface TesseractInitOptions {
    load_system_dawg?: string;
    load_freq_dawg?: string;
    [key: string]: string | undefined;
  }

  export interface TesseractWorkerOptions {
    corePath?: string;
    langPath?: string;
    cachePath?: string;
    dataPath?: string;
    workerPath?: string;
    cacheMethod?: string;
    workerBlobURL?: boolean;
    gzip?: boolean;
    legacyLang?: boolean;
    legacyCore?: boolean;
    logger?: (message: unknown) => void;
    errorHandler?: (error: unknown) => void;
  }

  export interface TesseractRecognizeResult {
    data: {
      text: string;
    };
  }

  export interface TesseractWorker {
    recognize(
      image: Buffer | Uint8Array | string,
    ): Promise<TesseractRecognizeResult>;
    terminate(): Promise<void>;
  }

  export function createWorker(
    languages?: string | string[],
    oem?: number,
    options?: Partial<TesseractWorkerOptions>,
    config?: string | Partial<TesseractInitOptions>,
  ): Promise<TesseractWorker>;
}
