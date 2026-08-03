import { BadRequestException, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { createWorker } from 'tesseract.js';
import { DataSource } from 'typeorm';
import { GrocyService } from '../grocy/grocy.service';

const RECEIPT_ITEM_REGEX =
  /^(?<name>.+?)\s+(?<vatRate>\d{1,2}[.,]\d{1,2})\s*%\s+(?<price>-?\d+[.,]\d{2})$/;
const QUANTITY_HINT_REGEX =
  /^(?<quantity>\d+)\s*x\s*E\s*(?<unitPrice>\d+[.,]\d{2})$/i;

export interface ParsedReceiptItem {
  name: string;
  rawName: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  vatRate: number;
  discountTotal: number;
}

export interface ParsedReceiptResponse {
  fileName: string;
  mimeType: string;
  source: 'pdf' | 'ocr';
  storeName: string;
  storeKey: string;
  items: ParsedReceiptItem[];
  subtotal: number | null;
  total: number | null;
  rawText: string;
  alreadyImported: boolean;
  existingReceiptId: number | null;
}

export interface MatchCandidatesRequestItem {
  name: string;
}

export interface MatchCandidatesRequest {
  storeName?: string;
  items: MatchCandidatesRequestItem[];
}

export interface MatchCandidate {
  productId: number;
  productName: string;
  score: number;
}

export interface MatchCandidatesResponseItem {
  receiptName: string;
  receiptNameNormalized: string;
  selectedProductId: number | null;
  selectedProductName: string | null;
  selectedScore: number | null;
  autoAccepted: boolean;
  mappedFromHistory: boolean;
  candidates: MatchCandidate[];
}

export interface MatchCandidatesResponse {
  storeName: string;
  storeKey: string;
  highConfidenceThreshold: number;
  grocyProductsPageUrl: string;
  results: MatchCandidatesResponseItem[];
}

export interface SaveMappingsRequestItem {
  receiptName: string;
  grocyProductId: number;
  grocyProductName: string;
  confidence?: number;
}

export interface SaveMappingsRequest {
  storeName?: string;
  mappings: SaveMappingsRequestItem[];
}

export interface SaveMappingsResponse {
  storeName: string;
  storeKey: string;
  savedCount: number;
}

export interface SaveReceiptRequestItem {
  receiptName: string;
  quantity: number;
  unitPrice: number;
  discountTotal: number;
  lineTotalDiscounted: number;
  vatRate: number;
  grocyProductId: number;
  grocyProductName: string;
}

export interface SaveReceiptRequest {
  storeName?: string;
  source?: 'pdf' | 'ocr';
  fileName?: string;
  purchasedAt?: string;
  subtotal?: number | null;
  total?: number | null;
  rawText?: string;
  items: SaveReceiptRequestItem[];
}

export interface SaveReceiptResponse {
  receiptId: number;
  savedItemsCount: number;
  savedPricePointsCount: number;
  duplicatedImport: boolean;
}

export interface ShoppingInsightsOverview {
  receiptsCount: number;
  totalSpent: number;
  averageReceiptTotal: number;
}

export interface ShoppingInsightsMonthlyTotal {
  month: string;
  totalSpent: number;
}

export interface ShoppingInsightsMonthlyReceipt {
  month: string;
  receiptsCount: number;
  averageReceiptTotal: number;
}

export interface ShoppingInsightsTopProduct {
  grocyProductId: number;
  grocyProductName: string;
  totalSpent: number;
  averageUnitPrice: number;
  minUnitPrice: number;
  maxUnitPrice: number;
  medianUnitPrice: number;
  lastUnitPrice: number;
  observations: number;
}

export interface ShoppingInsightsPricePoint {
  observedAt: string;
  receiptId: number;
  unitPrice: number;
  quantity: number;
  lineTotalDiscounted: number;
}

export interface ShoppingInsightsProductTrend {
  grocyProductId: number;
  grocyProductName: string;
  points: ShoppingInsightsPricePoint[];
}

export interface ShoppingInsightsResponse {
  periodDays: number;
  generatedAt: string;
  overview: ShoppingInsightsOverview;
  monthlyTotals: ShoppingInsightsMonthlyTotal[];
  monthlyReceipts: ShoppingInsightsMonthlyReceipt[];
  topProductsBySpend: ShoppingInsightsTopProduct[];
  selectedProductsTrend: ShoppingInsightsProductTrend[];
}

interface OcrWorker {
  recognize(image: Buffer): Promise<{ data: { text: string } }>;
  setParameters(parameters: Record<string, string | number>): Promise<void>;
  terminate(): Promise<void>;
}

interface PdfParseResult {
  text?: string;
}

interface PdfParseModule {
  default: (input: Buffer) => Promise<PdfParseResult>;
}

interface GrocyProductLite {
  id: number;
  name: string;
  normalizedName: string;
  tokens: Set<string>;
}

interface StoredMappingRow {
  grocy_product_id: number;
  grocy_product_name_snapshot: string;
  confidence: number;
}

interface ExistingReceiptRow {
  id: number;
}

interface ExistingReceiptCandidateRow {
  id: number;
  raw_text: string | null;
  total: number | null;
}

interface ShoppingInsightsOverviewRow {
  receipts_count: number | string;
  total_spent: number | string | null;
  average_receipt_total: number | string | null;
}

interface ShoppingInsightsMonthlyTotalRow {
  month: string;
  total_spent: number | string | null;
}

interface ShoppingInsightsMonthlyReceiptRow {
  month: string;
  receipts_count: number | string;
  average_receipt_total: number | string | null;
}

interface ShoppingInsightsTopProductRow {
  grocy_product_id: number | string;
  grocy_product_name: string | null;
  total_spent: number | string | null;
  average_unit_price: number | string | null;
  min_unit_price: number | string | null;
  max_unit_price: number | string | null;
  last_unit_price: number | string | null;
  observations: number | string;
}

interface ProductMedianRow {
  grocy_product_id: number | string;
  unit_price: number | string | null;
}

interface ShoppingInsightsTrendRow {
  grocy_product_id: number | string;
  grocy_product_name: string | null;
  observed_at: string;
  receipt_id: number | string;
  unit_price: number | string | null;
  quantity: number | string | null;
  line_total_discounted: number | string | null;
}

const DEFAULT_STORE_NAME = 'NEGOZIO SCONOSCIUTO';
const DEFAULT_STORE_KEY = 'NEGOZIO_SCONOSCIUTO';
const HIGH_CONFIDENCE_THRESHOLD = 0.86;
const DEFAULT_INSIGHTS_PERIOD_DAYS = 180;
const MAX_INSIGHTS_PERIOD_DAYS = 730;
const TOP_PRODUCTS_LIMIT = 8;

@Injectable()
export class SpesaService implements OnModuleInit, OnModuleDestroy {
  private ocrWorker: OcrWorker | null = null;
  private ocrWorkerSetupPromise: Promise<OcrWorker> | null = null;
  private ocrQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly grocyService: GrocyService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS receipt_product_mapping (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_key TEXT NOT NULL,
        store_name TEXT NOT NULL,
        receipt_name_raw TEXT NOT NULL,
        receipt_name_normalized TEXT NOT NULL,
        grocy_product_id INTEGER NOT NULL,
        grocy_product_name_snapshot TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 1,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_receipt_product_mapping_store_name_norm
      ON receipt_product_mapping(store_key, receipt_name_normalized)
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_key TEXT NOT NULL,
        store_name TEXT NOT NULL,
        purchased_at TEXT NOT NULL,
        source TEXT,
        file_name TEXT,
        subtotal REAL,
        total REAL,
        raw_text TEXT,
        fingerprint TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    await this.dataSource.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_receipts_fingerprint
      ON receipts(fingerprint)
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS receipt_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_id INTEGER NOT NULL,
        store_key TEXT NOT NULL,
        receipt_product_name TEXT NOT NULL,
        receipt_product_name_normalized TEXT NOT NULL,
        grocy_product_id INTEGER NOT NULL,
        grocy_product_name_snapshot TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit_price REAL NOT NULL,
        discount_total REAL NOT NULL,
        line_total_discounted REAL NOT NULL,
        vat_rate REAL NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt_id
      ON receipt_items(receipt_id)
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS product_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_id INTEGER NOT NULL,
        grocy_product_id INTEGER NOT NULL,
        store_key TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        unit_price REAL NOT NULL,
        quantity REAL NOT NULL,
        line_total_discounted REAL NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS idx_price_history_product_store_date
      ON product_price_history(grocy_product_id, store_key, observed_at)
    `);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.ocrWorker) {
      return;
    }

    await this.ocrWorker.terminate();
    this.ocrWorker = null;
    this.ocrWorkerSetupPromise = null;
    this.ocrQueue = Promise.resolve();
  }

  async parseReceiptFile(
    file: Express.Multer.File,
  ): Promise<ParsedReceiptResponse> {
    if (!file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Il file caricato e vuoto.');
    }

    const mimeType = (file.mimetype ?? '').toLowerCase();
    const isPdf =
      mimeType.includes('pdf') ||
      file.originalname.toLowerCase().endsWith('.pdf');
    const isImage = mimeType.startsWith('image/');

    if (!isPdf && !isImage) {
      throw new BadRequestException(
        "Formato non supportato. Carica un PDF o un'immagine dello scontrino.",
      );
    }

    const rawText = isPdf
      ? await this.extractTextFromPdf(file.buffer)
      : await this.extractTextWithOcr(file.buffer);
    const items = this.extractItemsFromReceiptText(rawText);
    const storeName = this.extractStoreName(rawText);
    const storeKey = this.normalizeStoreKey(storeName);
    const subtotal = this.extractTotalValue(rawText, /SUBTOTALE\s+(\d+[.,]\d{2})/i);
    const total = this.extractTotalValue(
      rawText,
      /TOTALE\s+COMPLESSIVO\s+(\d+[.,]\d{2})/i,
    );
    const existingReceiptId = await this.findExistingReceiptByContent({
      storeKey,
      total,
      rawText,
    });

    return {
      fileName: file.originalname,
      mimeType: file.mimetype,
      source: isPdf ? 'pdf' : 'ocr',
      storeName,
      storeKey,
      items,
      subtotal,
      total,
      rawText,
      alreadyImported: existingReceiptId !== null,
      existingReceiptId,
    };
  }

  async getMatchCandidates(
    request: MatchCandidatesRequest,
  ): Promise<MatchCandidatesResponse> {
    const inputItems = Array.isArray(request.items) ? request.items : [];
    const deduplicatedItems = new Map<string, string>();

    for (const entry of inputItems) {
      const receiptName = (entry.name ?? '').trim();
      const receiptNameNormalized = this.normalizeForMatching(receiptName);
      if (!receiptNameNormalized) {
        continue;
      }

      if (!deduplicatedItems.has(receiptNameNormalized)) {
        deduplicatedItems.set(receiptNameNormalized, receiptName);
      }
    }

    if (deduplicatedItems.size === 0) {
      throw new BadRequestException('Nessun prodotto da analizzare.');
    }

    const storeName = this.normalizeStoreName(request.storeName);
    const storeKey = this.normalizeStoreKey(storeName);
    const grocyProducts = await this.loadGrocyProducts();
    const results: MatchCandidatesResponseItem[] = [];

    for (const [receiptNameNormalized, receiptName] of deduplicatedItems) {

      const storedMapping = await this.findStoredMapping(
        storeKey,
        receiptNameNormalized,
      );
      if (storedMapping) {
        results.push({
          receiptName,
          receiptNameNormalized,
          selectedProductId: storedMapping.grocy_product_id,
          selectedProductName: storedMapping.grocy_product_name_snapshot,
          selectedScore: this.roundScore(storedMapping.confidence),
          autoAccepted: true,
          mappedFromHistory: true,
          candidates: [],
        });
        continue;
      }

      const candidates = this.findGrocyCandidates(
        receiptNameNormalized,
        grocyProducts,
      );
      const bestCandidate = candidates[0] ?? null;
      const autoAccepted =
        bestCandidate !== null &&
        bestCandidate.score >= HIGH_CONFIDENCE_THRESHOLD;

      results.push({
        receiptName,
        receiptNameNormalized,
        selectedProductId: autoAccepted ? bestCandidate.productId : null,
        selectedProductName: autoAccepted ? bestCandidate.productName : null,
        selectedScore: autoAccepted ? bestCandidate.score : null,
        autoAccepted,
        mappedFromHistory: false,
        candidates,
      });
    }

    return {
      storeName,
      storeKey,
      highConfidenceThreshold: HIGH_CONFIDENCE_THRESHOLD,
      grocyProductsPageUrl: this.grocyService.getProductsPageUrl(),
      results,
    };
  }

  async saveMappings(request: SaveMappingsRequest): Promise<SaveMappingsResponse> {
    const mappings = Array.isArray(request.mappings) ? request.mappings : [];
    if (mappings.length === 0) {
      throw new BadRequestException('Nessun mapping da salvare.');
    }

    const storeName = this.normalizeStoreName(request.storeName);
    const storeKey = this.normalizeStoreKey(storeName);
    const now = new Date().toISOString();
    let savedCount = 0;

    for (const mapping of mappings) {
      const receiptNameRaw = (mapping.receiptName ?? '').trim();
      const receiptNameNormalized = this.normalizeForMatching(receiptNameRaw);
      const grocyProductId = Number(mapping.grocyProductId);
      const grocyProductName = (mapping.grocyProductName ?? '').trim();
      const confidence = this.normalizeConfidence(mapping.confidence);

      if (!receiptNameNormalized || !Number.isInteger(grocyProductId) || !grocyProductName) {
        continue;
      }

      await this.dataSource.query(
        `
          INSERT INTO receipt_product_mapping (
            store_key,
            store_name,
            receipt_name_raw,
            receipt_name_normalized,
            grocy_product_id,
            grocy_product_name_snapshot,
            confidence,
            usage_count,
            last_used_at,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
          ON CONFLICT(store_key, receipt_name_normalized)
          DO UPDATE SET
            store_name = excluded.store_name,
            receipt_name_raw = excluded.receipt_name_raw,
            grocy_product_id = excluded.grocy_product_id,
            grocy_product_name_snapshot = excluded.grocy_product_name_snapshot,
            confidence = excluded.confidence,
            usage_count = receipt_product_mapping.usage_count + 1,
            last_used_at = excluded.last_used_at,
            updated_at = excluded.updated_at
        `,
        [
          storeKey,
          storeName,
          receiptNameRaw,
          receiptNameNormalized,
          grocyProductId,
          grocyProductName,
          confidence,
          now,
          now,
          now,
        ],
      );

      savedCount += 1;
    }

    return {
      storeName,
      storeKey,
      savedCount,
    };
  }

  async saveReceipt(request: SaveReceiptRequest): Promise<SaveReceiptResponse> {
    const items = Array.isArray(request.items) ? request.items : [];
    if (items.length === 0) {
      throw new BadRequestException('Nessuna riga scontrino da salvare.');
    }

    const storeName = this.normalizeStoreName(request.storeName);
    const storeKey = this.normalizeStoreKey(storeName);
    const source = request.source === 'ocr' ? 'ocr' : 'pdf';
    const fileName = (request.fileName ?? '').trim() || null;
    const purchasedAt = this.normalizeTimestamp(request.purchasedAt);
    const now = new Date().toISOString();
    const subtotal = this.normalizeOptionalMoney(request.subtotal);
    const total = this.normalizeOptionalMoney(request.total);
    const rawText = typeof request.rawText === 'string' ? request.rawText : '';
    const fingerprint = this.buildReceiptFingerprint({
      storeKey,
      purchasedAt,
      total,
      rawText,
    });

    const normalizedItems = items
      .map((item) => {
        const receiptName = (item.receiptName ?? '').trim();
        const receiptNameNormalized = this.normalizeForMatching(receiptName);
        const grocyProductId = Number(item.grocyProductId);
        const grocyProductName = (item.grocyProductName ?? '').trim();
        const quantity = this.normalizePositiveNumber(item.quantity);
        const unitPrice = this.normalizePositiveNumber(item.unitPrice);
        const discountTotal = this.normalizeNonNegativeNumber(item.discountTotal);
        const lineTotalDiscounted = this.normalizePositiveNumber(
          item.lineTotalDiscounted,
        );
        const vatRate = this.normalizeNonNegativeNumber(item.vatRate);

        if (
          !receiptNameNormalized ||
          !Number.isInteger(grocyProductId) ||
          grocyProductId <= 0 ||
          !grocyProductName ||
          quantity <= 0 ||
          unitPrice < 0 ||
          lineTotalDiscounted < 0
        ) {
          return null;
        }

        return {
          receiptName,
          receiptNameNormalized,
          grocyProductId,
          grocyProductName,
          quantity,
          unitPrice,
          discountTotal,
          lineTotalDiscounted,
          vatRate,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (normalizedItems.length === 0) {
      throw new BadRequestException('Nessuna riga valida da salvare.');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const existingRows = (await queryRunner.query(
        `SELECT id FROM receipts WHERE fingerprint = ? LIMIT 1`,
        [fingerprint],
      )) as ExistingReceiptRow[];

      if (existingRows[0]) {
        await queryRunner.rollbackTransaction();
        return {
          receiptId: Number(existingRows[0].id),
          savedItemsCount: 0,
          savedPricePointsCount: 0,
          duplicatedImport: true,
        };
      }

      await queryRunner.query(
        `
          INSERT INTO receipts (
            store_key,
            store_name,
            purchased_at,
            source,
            file_name,
            subtotal,
            total,
            raw_text,
            fingerprint,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          storeKey,
          storeName,
          purchasedAt,
          source,
          fileName,
          subtotal,
          total,
          rawText,
          fingerprint,
          now,
        ],
      );

      const receiptIdRows = (await queryRunner.query(
        `SELECT last_insert_rowid() as id`,
      )) as ExistingReceiptRow[];
      const receiptId = Number(receiptIdRows[0]?.id ?? 0);

      if (!Number.isInteger(receiptId) || receiptId <= 0) {
        throw new BadRequestException('Impossibile determinare l\'id dello scontrino salvato.');
      }

      for (const item of normalizedItems) {
        await queryRunner.query(
          `
            INSERT INTO receipt_items (
              receipt_id,
              store_key,
              receipt_product_name,
              receipt_product_name_normalized,
              grocy_product_id,
              grocy_product_name_snapshot,
              quantity,
              unit_price,
              discount_total,
              line_total_discounted,
              vat_rate,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            receiptId,
            storeKey,
            item.receiptName,
            item.receiptNameNormalized,
            item.grocyProductId,
            item.grocyProductName,
            item.quantity,
            item.unitPrice,
            item.discountTotal,
            item.lineTotalDiscounted,
            item.vatRate,
            now,
          ],
        );

        await queryRunner.query(
          `
            INSERT INTO product_price_history (
              receipt_id,
              grocy_product_id,
              store_key,
              observed_at,
              unit_price,
              quantity,
              line_total_discounted,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            receiptId,
            item.grocyProductId,
            storeKey,
            purchasedAt,
            item.unitPrice,
            item.quantity,
            item.lineTotalDiscounted,
            now,
          ],
        );
      }

      await queryRunner.commitTransaction();

      return {
        receiptId,
        savedItemsCount: normalizedItems.length,
        savedPricePointsCount: normalizedItems.length,
        duplicatedImport: false,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async getShoppingInsights(input: {
    days?: number;
    productIds?: number[];
  }): Promise<ShoppingInsightsResponse> {
    const periodDays = this.normalizeInsightsPeriodDays(input.days);
    const selectedProductIds = Array.isArray(input.productIds)
      ? input.productIds.filter((value) => Number.isInteger(value) && value > 0)
      : [];
    const selectedProductIdsUnique = [...new Set(selectedProductIds)].slice(0, 12);
    const periodStart = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000).toISOString();

    const overviewRows = (await this.dataSource.query(
      `
        SELECT
          COUNT(*) as receipts_count,
          COALESCE(SUM(total), 0) as total_spent,
          COALESCE(AVG(total), 0) as average_receipt_total
        FROM receipts
        WHERE purchased_at >= ?
      `,
      [periodStart],
    )) as ShoppingInsightsOverviewRow[];

    const monthlyTotalsRows = (await this.dataSource.query(
      `
        SELECT
          substr(purchased_at, 1, 7) as month,
          COALESCE(SUM(total), 0) as total_spent
        FROM receipts
        WHERE purchased_at >= ?
        GROUP BY substr(purchased_at, 1, 7)
        ORDER BY month ASC
      `,
      [periodStart],
    )) as ShoppingInsightsMonthlyTotalRow[];

    const monthlyReceiptsRows = (await this.dataSource.query(
      `
        SELECT
          substr(purchased_at, 1, 7) as month,
          COUNT(*) as receipts_count,
          COALESCE(AVG(total), 0) as average_receipt_total
        FROM receipts
        WHERE purchased_at >= ?
        GROUP BY substr(purchased_at, 1, 7)
        ORDER BY month ASC
      `,
      [periodStart],
    )) as ShoppingInsightsMonthlyReceiptRow[];

    const topProductsRows = (await this.dataSource.query(
      `
        SELECT
          p.grocy_product_id,
          COALESCE(MAX(i.grocy_product_name_snapshot), 'Prodotto #' || p.grocy_product_id) as grocy_product_name,
          COALESCE(SUM(p.line_total_discounted), 0) as total_spent,
          COALESCE(AVG(p.unit_price), 0) as average_unit_price,
          COALESCE(MIN(p.unit_price), 0) as min_unit_price,
          COALESCE(MAX(p.unit_price), 0) as max_unit_price,
          COALESCE((
            SELECT p2.unit_price
            FROM product_price_history p2
            WHERE p2.grocy_product_id = p.grocy_product_id
              AND p2.observed_at >= ?
            ORDER BY p2.observed_at DESC, p2.id DESC
            LIMIT 1
          ), 0) as last_unit_price,
          COUNT(*) as observations
        FROM product_price_history p
        LEFT JOIN receipt_items i
          ON i.receipt_id = p.receipt_id
          AND i.grocy_product_id = p.grocy_product_id
        WHERE p.observed_at >= ?
        GROUP BY p.grocy_product_id
        ORDER BY total_spent DESC
        LIMIT ?
      `,
      [periodStart, periodStart, TOP_PRODUCTS_LIMIT],
    )) as ShoppingInsightsTopProductRow[];

    const topProductIds = topProductsRows
      .map((row) => Number(row.grocy_product_id))
      .filter((productId) => Number.isInteger(productId) && productId > 0);

    const medianByProductId = new Map<number, number>();
    if (topProductIds.length > 0) {
      const placeholders = topProductIds.map(() => '?').join(', ');
      const medianRows = (await this.dataSource.query(
        `
          SELECT grocy_product_id, unit_price
          FROM product_price_history
          WHERE observed_at >= ?
            AND grocy_product_id IN (${placeholders})
          ORDER BY grocy_product_id ASC, unit_price ASC
        `,
        [periodStart, ...topProductIds],
      )) as ProductMedianRow[];

      const valuesByProductId = new Map<number, number[]>();
      for (const row of medianRows) {
        const productId = Number(row.grocy_product_id);
        const unitPrice = Number(row.unit_price);
        if (!Number.isInteger(productId) || productId <= 0 || !Number.isFinite(unitPrice)) {
          continue;
        }

        if (!valuesByProductId.has(productId)) {
          valuesByProductId.set(productId, []);
        }

        valuesByProductId.get(productId)?.push(unitPrice);
      }

      for (const [productId, values] of valuesByProductId.entries()) {
        medianByProductId.set(productId, this.computeMedian(values));
      }
    }

    let trendRows: ShoppingInsightsTrendRow[] = [];
    if (selectedProductIdsUnique.length > 0) {
      const placeholders = selectedProductIdsUnique.map(() => '?').join(', ');
      trendRows = (await this.dataSource.query(
        `
          SELECT
            p.grocy_product_id,
            COALESCE(MAX(i.grocy_product_name_snapshot), 'Prodotto #' || p.grocy_product_id) as grocy_product_name,
            p.observed_at,
            p.receipt_id,
            p.unit_price,
            p.quantity,
            p.line_total_discounted
          FROM product_price_history p
          LEFT JOIN receipt_items i
            ON i.receipt_id = p.receipt_id
            AND i.grocy_product_id = p.grocy_product_id
          WHERE p.observed_at >= ?
            AND p.grocy_product_id IN (${placeholders})
          GROUP BY p.id
          ORDER BY p.grocy_product_id ASC, p.observed_at ASC, p.id ASC
        `,
        [periodStart, ...selectedProductIdsUnique],
      )) as ShoppingInsightsTrendRow[];
    }

    const selectedProductsTrendById = new Map<number, ShoppingInsightsProductTrend>();
    for (const row of trendRows) {
      const productId = Number(row.grocy_product_id);
      if (!Number.isInteger(productId) || productId <= 0) {
        continue;
      }

      if (!selectedProductsTrendById.has(productId)) {
        selectedProductsTrendById.set(productId, {
          grocyProductId: productId,
          grocyProductName: (row.grocy_product_name ?? '').trim() || `Prodotto #${productId}`,
          points: [],
        });
      }

      selectedProductsTrendById.get(productId)?.points.push({
        observedAt: row.observed_at,
        receiptId: Number(row.receipt_id) || 0,
        unitPrice: this.roundMoney(Number(row.unit_price) || 0),
        quantity: this.roundMoney(Number(row.quantity) || 0),
        lineTotalDiscounted: this.roundMoney(Number(row.line_total_discounted) || 0),
      });
    }

    return {
      periodDays,
      generatedAt: new Date().toISOString(),
      overview: {
        receiptsCount: Number(overviewRows[0]?.receipts_count ?? 0),
        totalSpent: this.roundMoney(Number(overviewRows[0]?.total_spent ?? 0)),
        averageReceiptTotal: this.roundMoney(
          Number(overviewRows[0]?.average_receipt_total ?? 0),
        ),
      },
      monthlyTotals: monthlyTotalsRows.map((row) => ({
        month: row.month,
        totalSpent: this.roundMoney(Number(row.total_spent ?? 0)),
      })),
      monthlyReceipts: monthlyReceiptsRows.map((row) => ({
        month: row.month,
        receiptsCount: Number(row.receipts_count),
        averageReceiptTotal: this.roundMoney(Number(row.average_receipt_total ?? 0)),
      })),
      topProductsBySpend: topProductsRows.map((row) => ({
        grocyProductId: Number(row.grocy_product_id),
        grocyProductName:
          (row.grocy_product_name ?? '').trim() || `Prodotto #${String(row.grocy_product_id)}`,
        totalSpent: this.roundMoney(Number(row.total_spent ?? 0)),
        averageUnitPrice: this.roundMoney(Number(row.average_unit_price ?? 0)),
        minUnitPrice: this.roundMoney(Number(row.min_unit_price ?? 0)),
        maxUnitPrice: this.roundMoney(Number(row.max_unit_price ?? 0)),
        medianUnitPrice: this.roundMoney(
          medianByProductId.get(Number(row.grocy_product_id)) ??
            Number(row.average_unit_price ?? 0),
        ),
        lastUnitPrice: this.roundMoney(Number(row.last_unit_price ?? 0)),
        observations: Number(row.observations),
      })),
      selectedProductsTrend: [...selectedProductsTrendById.values()],
    };
  }

  private async extractTextFromPdf(buffer: Buffer): Promise<string> {
    const pdfModuleCandidate: unknown = await import('pdf-parse');
    const pdfModule = pdfModuleCandidate as PdfParseModule;
    const parsed = await pdfModule.default(buffer);
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    if (!text) {
      throw new BadRequestException(
        'PDF senza testo leggibile. Prova con una foto dello scontrino.',
      );
    }

    return text;
  }

  private async extractTextWithOcr(buffer: Buffer): Promise<string> {
    return this.runOcrJob(async (worker) => {
      const resultCandidate: unknown = await worker.recognize(buffer);
      const result = resultCandidate as { data: { text: string } };

      const normalizedText = result.data.text
        .replace(/\u00a0/g, ' ')
        .replace(/[\u200b-\u200d\ufeff]/g, '')
        .trim();

      if (!normalizedText) {
        throw new BadRequestException('OCR non riuscito: testo non rilevato.');
      }

      return normalizedText;
    });
  }

  private extractItemsFromReceiptText(rawText: string): ParsedReceiptItem[] {
    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const items: ParsedReceiptItem[] = [];
    let inItemsSection = false;
    let previousItem: ParsedReceiptItem | null = null;
    let previousNormalizedLine: string | null = null;

    for (const line of lines) {
      const normalizedLine = line.replace(/\s+/g, ' ').trim();

      if (/DESCRIZIONE\s+IVA\s+PREZZO/i.test(normalizedLine)) {
        inItemsSection = true;
        continue;
      }

      if (!inItemsSection) {
        continue;
      }

      if (
        /^(SUBTOTALE|TOTALE\s+COMPLESSIVO|DI\s+CUI\s+IVA)/i.test(normalizedLine)
      ) {
        break;
      }

      const quantityMatch = normalizedLine.match(QUANTITY_HINT_REGEX);
      if (quantityMatch?.groups) {
        previousNormalizedLine = normalizedLine;
        continue;
      }

      const parsedLine = this.parseReceiptItemLine(normalizedLine);
      if (!parsedLine) {
        continue;
      }

      const rawName = parsedLine.rawName;
      const parsedPrice = parsedLine.price;
      const parsedVatRate = parsedLine.vatRate;

      if (this.looksLikeDiscountRow(rawName)) {
        if (previousItem) {
          previousItem.discountTotal = this.roundMoney(
            previousItem.discountTotal + Math.abs(parsedPrice),
          );
        }
        previousNormalizedLine = normalizedLine;
        continue;
      }

      const previousLineQuantityMatch = previousNormalizedLine?.match(
        QUANTITY_HINT_REGEX,
      );
      let quantity = 1;
      let unitPrice = parsedPrice;
      let totalPrice = parsedPrice;

      if (previousLineQuantityMatch?.groups) {
        const hintedQuantity = Number(previousLineQuantityMatch.groups.quantity);
        const hintedUnitPrice = this.parseMoneyValue(
          previousLineQuantityMatch.groups.unitPrice,
        );

        if (hintedQuantity > 1) {
          quantity = hintedQuantity;
          unitPrice = hintedUnitPrice;
          totalPrice = parsedPrice;
        }
      }

      const item: ParsedReceiptItem = {
        name: this.normalizeProductName(rawName),
        rawName,
        quantity,
        unitPrice,
        totalPrice,
        vatRate: parsedVatRate,
        discountTotal: 0,
      };

      items.push(item);
      previousItem = item;
      previousNormalizedLine = normalizedLine;
    }

    return items;
  }

  private parseReceiptItemLine(normalizedLine: string): {
    rawName: string;
    price: number;
    vatRate: number;
  } | null {
    const strictMatch = normalizedLine.match(RECEIPT_ITEM_REGEX);
    if (strictMatch?.groups) {
      const rawName = strictMatch.groups.name.trim();
      const price = this.parseMoneyValue(strictMatch.groups.price);
      const vatRate = this.parsePercentValue(strictMatch.groups.vatRate);

      return {
        rawName,
        price,
        vatRate,
      };
    }

    const fallbackPriceMatch = normalizedLine.match(/(?<price>-?\d+[.,]\d{2})\s*$/);
    if (!fallbackPriceMatch?.groups?.price) {
      return null;
    }

    const price = this.parseMoneyValue(fallbackPriceMatch.groups.price);
    const lineWithoutPrice = normalizedLine
      .slice(0, fallbackPriceMatch.index)
      .replace(/\s+/g, ' ')
      .trim();

    if (!lineWithoutPrice) {
      return null;
    }

    const fallbackVatMatch = lineWithoutPrice.match(
      /(?:\bCF\b\s*)?(?<vatRate>\d{1,2}[.,]\d{1,2})\s*%?$/i,
    );
    const vatRate = fallbackVatMatch?.groups?.vatRate
      ? this.parsePercentValue(fallbackVatMatch.groups.vatRate)
      : 0;

    const rawName = lineWithoutPrice
      .replace(/(?:\bCF\b\s*)?\d{1,2}[.,]\d{1,2}\s*%?$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!rawName) {
      return null;
    }

    if (/^(SUBTOTALE|TOTALE\s+COMPLESSIVO|DI\s+CUI\s+IVA|PAGAMENTO)/i.test(rawName)) {
      return null;
    }

    return {
      rawName,
      price,
      vatRate,
    };
  }

  private async runOcrJob<T>(job: (worker: OcrWorker) => Promise<T>): Promise<T> {
    const previousQueue = this.ocrQueue;
    let releaseQueue!: () => void;
    this.ocrQueue = new Promise<void>((resolve) => {
      releaseQueue = resolve;
    });

    await previousQueue;

    try {
      const worker = await this.getOrCreateOcrWorker();
      return await job(worker);
    } finally {
      releaseQueue();
    }
  }

  private async getOrCreateOcrWorker(): Promise<OcrWorker> {
    if (this.ocrWorker) {
      return this.ocrWorker;
    }

    if (!this.ocrWorkerSetupPromise) {
      this.ocrWorkerSetupPromise = (async () => {
        const workerCandidate: unknown = await createWorker('ita+eng');
        const worker = workerCandidate as OcrWorker;

        await worker.setParameters({
          tessedit_pageseg_mode: 6,
          preserve_interword_spaces: 1,
        });

        this.ocrWorker = worker;
        return worker;
      })();
    }

    try {
      return await this.ocrWorkerSetupPromise;
    } catch (error) {
      this.ocrWorkerSetupPromise = null;
      throw error;
    }
  }

  private async loadGrocyProducts(): Promise<GrocyProductLite[]> {
    const rawProducts = await this.grocyService.getProducts();
    if (!Array.isArray(rawProducts)) {
      return [];
    }

    const mappedProducts: GrocyProductLite[] = [];

    for (const entry of rawProducts) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const record = entry as Record<string, unknown>;
      const id = Number(record.id);
      const name = typeof record.name === 'string' ? record.name.trim() : '';
      if (!Number.isInteger(id) || !name) {
        continue;
      }

      const normalizedName = this.normalizeProductName(name);
      const normalizedForMatching = this.normalizeForMatching(normalizedName);
      mappedProducts.push({
        id,
        name,
        normalizedName: normalizedForMatching,
        tokens: this.toTokenSet(normalizedForMatching),
      });
    }

    return mappedProducts;
  }

  private async findStoredMapping(
    storeKey: string,
    receiptNameNormalized: string,
  ): Promise<StoredMappingRow | null> {
    const rows = (await this.dataSource.query(
      `
        SELECT
          grocy_product_id,
          grocy_product_name_snapshot,
          confidence
        FROM receipt_product_mapping
        WHERE store_key = ?
          AND receipt_name_normalized = ?
        LIMIT 1
      `,
      [storeKey, receiptNameNormalized],
    )) as StoredMappingRow[];

    return rows[0] ?? null;
  }

  private findGrocyCandidates(
    receiptNameNormalized: string,
    products: GrocyProductLite[],
  ): MatchCandidate[] {
    const receiptTokens = this.toTokenSet(receiptNameNormalized);

    const candidates = products
      .map((product) => {
        const score = this.computeSimilarityScore(
          receiptNameNormalized,
          receiptTokens,
          product.normalizedName,
          product.tokens,
        );

        return {
          productId: product.id,
          productName: product.name,
          score: this.roundScore(score),
        };
      })
      .filter((candidate) => candidate.score > 0.35)
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }

        return left.productName.localeCompare(right.productName);
      });

    return candidates.slice(0, 5);
  }

  private computeSimilarityScore(
    leftName: string,
    leftTokens: Set<string>,
    rightName: string,
    rightTokens: Set<string>,
  ): number {
    if (!leftName || !rightName) {
      return 0;
    }

    const overlapCount = [...leftTokens].filter((token) => rightTokens.has(token)).length;
    const unionCount = new Set([...leftTokens, ...rightTokens]).size;
    const tokenScore = unionCount > 0 ? overlapCount / unionCount : 0;

    const maxLength = Math.max(leftName.length, rightName.length);
    const distance = this.levenshteinDistance(leftName, rightName);
    const charScore = maxLength > 0 ? 1 - distance / maxLength : 0;

    const containsBonus =
      leftName.includes(rightName) || rightName.includes(leftName) ? 0.08 : 0;

    return Math.min(1, Math.max(0, tokenScore * 0.65 + charScore * 0.35 + containsBonus));
  }

  private levenshteinDistance(left: string, right: string): number {
    if (left === right) {
      return 0;
    }

    if (left.length === 0) {
      return right.length;
    }

    if (right.length === 0) {
      return left.length;
    }

    const previousRow: number[] = [];
    for (let column = 0; column <= right.length; column += 1) {
      previousRow[column] = column;
    }

    for (let rowIndex = 1; rowIndex <= left.length; rowIndex += 1) {
      let previousDiagonal = previousRow[0];
      previousRow[0] = rowIndex;

      for (let columnIndex = 1; columnIndex <= right.length; columnIndex += 1) {
        const savedValue = previousRow[columnIndex];
        const substitutionCost =
          left[rowIndex - 1] === right[columnIndex - 1] ? 0 : 1;

        previousRow[columnIndex] = Math.min(
          previousRow[columnIndex] + 1,
          previousRow[columnIndex - 1] + 1,
          previousDiagonal + substitutionCost,
        );

        previousDiagonal = savedValue;
      }
    }

    return previousRow[right.length];
  }

  private toTokenSet(value: string): Set<string> {
    const tokens = value
      .split(' ')
      .map((token) => token.trim())
      .filter((token) => token.length > 1);

    return new Set(tokens);
  }

  private extractStoreName(rawText: string): string {
    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    for (const line of lines.slice(0, 12)) {
      const upper = line.toUpperCase();
      if (
        upper.startsWith('DOCUMENTO') ||
        upper.startsWith('DESCRIZIONE') ||
        upper.startsWith('P.I.') ||
        upper.startsWith('VIA ') ||
        upper.startsWith('NR.') ||
        upper.startsWith('PAGAMENTO')
      ) {
        continue;
      }

      if (/[A-Z]/i.test(line)) {
        return line;
      }
    }

    return DEFAULT_STORE_NAME;
  }

  private normalizeStoreName(value: string | undefined): string {
    const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
    return normalized || DEFAULT_STORE_NAME;
  }

  private normalizeStoreKey(value: string): string {
    const normalized = this.normalizeForMatching(value)
      .replace(/[^A-Z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .trim();

    return normalized || DEFAULT_STORE_KEY;
  }

  private extractTotalValue(rawText: string, regex: RegExp): number | null {
    const match = rawText.match(regex);
    if (!match?.[1]) {
      return null;
    }

    return this.parseMoneyValue(match[1]);
  }

  private parseMoneyValue(rawValue: string): number {
    const trimmed = rawValue.trim();
    const normalized = trimmed.includes(',')
      ? trimmed.replace(/\./g, '').replace(',', '.')
      : trimmed;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      return 0;
    }

    return this.roundMoney(parsed);
  }

  private parsePercentValue(rawValue: string): number {
    const normalized = rawValue.replace(',', '.').trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private normalizeProductName(rawName: string): string {
    const withoutPrefix = rawName
      .replace(/^[A-Z]-[A-Z]\s+/i, '')
      .replace(/^[A-Z]-/i, '')
      .replace(/^[A-Z]\s+/i, '');

    return withoutPrefix.replace(/\s+/g, ' ').trim();
  }

  private normalizeForMatching(rawName: string): string {
    return this.normalizeProductName(rawName)
      .toUpperCase()
      .replace(/[^A-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private normalizeReceiptRawText(rawText: string): string {
    return rawText.replace(/\s+/g, ' ').trim();
  }

  private async findExistingReceiptByContent(input: {
    storeKey: string;
    total: number | null;
    rawText: string;
  }): Promise<number | null> {
    const rows = (await this.dataSource.query(
      `
        SELECT id, raw_text, total
        FROM receipts
        WHERE store_key = ?
        ORDER BY id DESC
        LIMIT 250
      `,
      [input.storeKey],
    )) as ExistingReceiptCandidateRow[];

    if (rows.length === 0) {
      return null;
    }

    const normalizedIncomingText = this.normalizeReceiptRawText(input.rawText);
    const roundedIncomingTotal = input.total === null ? null : this.roundMoney(input.total);

    for (const row of rows) {
      const normalizedStoredText = this.normalizeReceiptRawText(row.raw_text ?? '');
      if (normalizedStoredText !== normalizedIncomingText) {
        continue;
      }

      const roundedStoredTotal =
        typeof row.total === 'number' && Number.isFinite(row.total)
          ? this.roundMoney(row.total)
          : null;

      if (roundedStoredTotal !== roundedIncomingTotal) {
        continue;
      }

      return Number(row.id);
    }

    return null;
  }

  private looksLikeDiscountRow(rawName: string): boolean {
    const normalized = rawName.toUpperCase();
    return (
      normalized.startsWith('SC') ||
      normalized.includes('SCONTO') ||
      normalized.includes('TAGLIO PREZZO') ||
      normalized.startsWith('PREZZO TUTELATO')
    );
  }

  private roundMoney(value: number): number {
    return Math.round(value * 100) / 100;
  }

  private roundScore(value: number): number {
    return Math.round(value * 1000) / 1000;
  }

  private normalizeConfidence(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 1;
    }

    return Math.max(0, Math.min(1, value));
  }

  private normalizeTimestamp(value: string | undefined): string {
    if (typeof value !== 'string' || !value.trim()) {
      return new Date().toISOString();
    }

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
      return new Date().toISOString();
    }

    return parsedDate.toISOString();
  }

  private normalizeOptionalMoney(value: number | null | undefined): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }

    return this.roundMoney(value);
  }

  private normalizeInsightsPeriodDays(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return DEFAULT_INSIGHTS_PERIOD_DAYS;
    }

    const rounded = Math.trunc(value);
    if (rounded <= 0) {
      return DEFAULT_INSIGHTS_PERIOD_DAYS;
    }

    return Math.min(rounded, MAX_INSIGHTS_PERIOD_DAYS);
  }

  private normalizePositiveNumber(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 0;
    }

    return this.roundMoney(value);
  }

  private computeMedian(sortedValues: number[]): number {
    if (sortedValues.length === 0) {
      return 0;
    }

    const middleIndex = Math.floor(sortedValues.length / 2);
    if (sortedValues.length % 2 === 0) {
      return this.roundMoney((sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2);
    }

    return this.roundMoney(sortedValues[middleIndex]);
  }

  private normalizeNonNegativeNumber(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return 0;
    }

    return this.roundMoney(Math.max(0, value));
  }

  private buildReceiptFingerprint(input: {
    storeKey: string;
    purchasedAt: string;
    total: number | null;
    rawText: string;
  }): string {
    const material = [
      input.storeKey,
      input.purchasedAt.slice(0, 16),
      input.total === null ? '' : String(this.roundMoney(input.total)),
      this.normalizeReceiptRawText(input.rawText),
    ].join('|');

    return createHash('sha256').update(material).digest('hex');
  }
}
