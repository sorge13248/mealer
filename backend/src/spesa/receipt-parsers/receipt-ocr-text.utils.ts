export function normalizeOcrOutputText(rawText: string): string {
  // Normalize OCR output so downstream parsers receive stable spacing and lines.
  return rawText
    .replace(/\u00a0/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

export function computeOcrTextQualityScore(text: string): number {
  // Heuristic score balancing density, structure and OCR noise ratio.
  if (!text) {
    return 0;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const alphaCount = (text.match(/[A-Za-z]/g) ?? []).length;
  const digitCount = (text.match(/\d/g) ?? []).length;
  const garbageCount = (text.match(/[^A-Za-z0-9\s.,:%\-/]/g) ?? []).length;
  const hasReceiptHeader = /DOCUMENTO|DESCRIZIONE|TOTALE|PAGAMENTO|IVA/i.test(
    text,
  );

  const signalChars = alphaCount + digitCount;
  const garbageRatio =
    signalChars + garbageCount > 0
      ? garbageCount / (signalChars + garbageCount)
      : 1;

  let score = 0;
  score += Math.min(lines.length / 18, 1) * 0.28;
  score += Math.min(signalChars / 420, 1) * 0.32;
  score += hasReceiptHeader ? 0.25 : 0;
  score += Math.max(0, 1 - garbageRatio * 2.4) * 0.15;

  if (text.length < 40) {
    score *= 0.5;
  }

  return Math.max(0, Math.min(1, score));
}
