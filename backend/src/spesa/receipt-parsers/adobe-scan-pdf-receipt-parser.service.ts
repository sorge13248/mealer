import { BadRequestException, Injectable } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { ReceiptOcrEngineService } from './receipt-ocr-engine.service';
import { ReceiptParsingDispatchResult } from './receipt-parser.types';

interface PdfImageCandidate {
  image: Buffer;
  width: number;
  height: number;
  area: number;
}

const PDF_OCR_MAX_IMAGE_CANDIDATES = 4;
const PDF_OCR_RENDER_DPI = 320;
const PDF_OCR_MAX_RENDERED_PAGES = 3;
const execFileAsync = promisify(execFile);

@Injectable()
export class AdobeScanPdfReceiptParserService {
  constructor(private readonly ocrEngine: ReceiptOcrEngineService) {}

  async parse(buffer: Buffer): Promise<ReceiptParsingDispatchResult> {
    // Prefer explicit page rendering for scanned PDFs, then fallback to embedded streams.
    const renderedPages = await this.extractRenderedPagesFromPdf(buffer);
    const embeddedCandidates = this.extractEmbeddedImagesFromPdf(buffer);

    const imageCandidates = [...renderedPages, ...embeddedCandidates]
      .sort((left, right) => right.area - left.area)
      .slice(0, PDF_OCR_MAX_IMAGE_CANDIDATES);

    if (imageCandidates.length === 0) {
      throw new BadRequestException(
        'PDF Adobe Scan senza immagini OCR utilizzabili.',
      );
    }

    let bestText = '';
    let bestScore = -1;

    // Run OCR on largest pages first and keep the best-quality recognized text.
    for (const candidate of imageCandidates) {
      try {
        const recognizedText = await this.ocrEngine.extractTextWithOcr(
          candidate.image,
        );
        const score = this.ocrEngine.computeOcrTextQualityScore(recognizedText);

        if (score > bestScore) {
          bestScore = score;
          bestText = recognizedText;
        }
      } catch {
        continue;
      }
    }

    if (!bestText) {
      throw new BadRequestException(
        'OCR non riuscito sul PDF Adobe Scan: testo non riconoscibile.',
      );
    }

    return {
      kind: 'adobe-scan-pdf',
      source: 'ocr',
      rawText: bestText,
    };
  }

  private async extractRenderedPagesFromPdf(
    buffer: Buffer,
  ): Promise<PdfImageCandidate[]> {
    const workspace = await mkdtemp(join(tmpdir(), 'mealer-pdf-ocr-'));
    const inputPdfPath = join(workspace, 'input.pdf');
    const outputPrefix = join(workspace, 'page');

    try {
      await writeFile(inputPdfPath, buffer);

      // pdftoppm is widely available in Linux distros and renders scanned pages reliably.
      await execFileAsync('pdftoppm', [
        '-png',
        '-r',
        String(PDF_OCR_RENDER_DPI),
        inputPdfPath,
        outputPrefix,
      ]);

      const files = (await readdir(workspace))
        .filter((fileName) => /^page-\d+\.png$/i.test(fileName))
        .sort((left, right) => left.localeCompare(right))
        .slice(0, PDF_OCR_MAX_RENDERED_PAGES);

      const candidates: PdfImageCandidate[] = [];
      for (let index = 0; index < files.length; index += 1) {
        const fileName = files[index];
        const filePath = join(workspace, fileName);
        const imageBuffer = await readFile(filePath);
        candidates.push({
          image: imageBuffer,
          width: 0,
          height: 0,
          // Keep rendered pages first in sort order when dimensions are unknown.
          area: Number.MAX_SAFE_INTEGER - index,
        });
      }

      return candidates;
    } catch {
      // Missing command or render failures should not block embedded-stream fallback.
      return [];
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }

  private extractEmbeddedImagesFromPdf(buffer: Buffer): PdfImageCandidate[] {
    // Lightweight stream scanner for /Subtype /Image objects encoded as DCT (JPEG).
    const binaryText = buffer.toString('latin1');
    const candidates: PdfImageCandidate[] = [];
    let cursor = 0;

    while (cursor < binaryText.length) {
      const imageTagIndex = binaryText.indexOf('/Subtype /Image', cursor);
      if (imageTagIndex < 0) {
        break;
      }

      const dictionaryStart = binaryText.lastIndexOf('<<', imageTagIndex);
      const streamIndex = binaryText.indexOf('stream', imageTagIndex);
      if (streamIndex < 0) {
        cursor = imageTagIndex + 14;
        continue;
      }

      const endStreamIndex = binaryText.indexOf('endstream', streamIndex + 6);
      if (endStreamIndex < 0) {
        cursor = streamIndex + 6;
        continue;
      }

      const dictionaryText =
        dictionaryStart >= 0
          ? binaryText.slice(dictionaryStart, streamIndex)
          : binaryText.slice(Math.max(0, imageTagIndex - 180), streamIndex);

      if (!/\/DCTDecode/i.test(dictionaryText)) {
        cursor = endStreamIndex + 9;
        continue;
      }

      let streamDataStart = streamIndex + 'stream'.length;
      if (
        binaryText[streamDataStart] === '\r' &&
        binaryText[streamDataStart + 1] === '\n'
      ) {
        streamDataStart += 2;
      } else if (
        binaryText[streamDataStart] === '\r' ||
        binaryText[streamDataStart] === '\n'
      ) {
        streamDataStart += 1;
      }

      let streamDataEnd = endStreamIndex;
      while (
        streamDataEnd > streamDataStart &&
        /\s/.test(binaryText[streamDataEnd - 1] ?? '')
      ) {
        streamDataEnd -= 1;
      }

      const rawImage = buffer.subarray(streamDataStart, streamDataEnd);
      const jpegImage = this.trimToJpegMarkers(rawImage);

      if (jpegImage.length > 0) {
        const widthMatch = dictionaryText.match(/\/Width\s+(\d+)/i);
        const heightMatch = dictionaryText.match(/\/Height\s+(\d+)/i);
        const width = Number(widthMatch?.[1] ?? 0);
        const height = Number(heightMatch?.[1] ?? 0);
        candidates.push({
          image: jpegImage,
          width,
          height,
          area: Math.max(1, width) * Math.max(1, height),
        });
      }

      cursor = endStreamIndex + 9;
    }

    return candidates;
  }

  private trimToJpegMarkers(imageBuffer: Buffer): Buffer {
    // Defensive trimming to recover a valid JPEG even when stream boundaries are noisy.
    const jpegStartMarker = Buffer.from([0xff, 0xd8]);
    const jpegEndMarker = Buffer.from([0xff, 0xd9]);
    const startIndex = imageBuffer.indexOf(jpegStartMarker);
    const endIndex = imageBuffer.lastIndexOf(jpegEndMarker);

    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) {
      return Buffer.alloc(0);
    }

    return imageBuffer.subarray(startIndex, endIndex + jpegEndMarker.length);
  }
}
