import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { GrocyService } from '../grocy/grocy.service';
import { ReceiptParserDispatcherService } from './receipt-parsers/receipt-parser-dispatcher.service';

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

export interface StoredReceiptListItem {
  id: number;
  storeName: string;
  storeKey: string;
  purchasedAt: string;
  source: 'pdf' | 'ocr';
  fileName: string | null;
  subtotal: number | null;
  total: number | null;
  itemCount: number;
  createdAt: string;
}

export interface StoredReceiptListResponse {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  items: StoredReceiptListItem[];
}

export interface StoredReceiptDetailItem {
  id: number;
  receiptProductId: number;
  receiptName: string;
  grocyProductId: number;
  grocyProductName: string;
  quantity: number;
  unitPrice: number;
  discountTotal: number;
  lineTotalDiscounted: number;
  vatRate: number;
  createdAt: string;
}

export interface StoredReceiptDetailResponse {
  receipt: StoredReceiptListItem;
  items: StoredReceiptDetailItem[];
}

export interface DeleteStoredReceiptResponse {
  receiptId: number;
  deletedReceipt: boolean;
  deletedItemsCount: number;
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

interface IdRow {
  id: number | string;
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
const DEFAULT_RECEIPTS_PAGE = 1;
const DEFAULT_RECEIPTS_PAGE_SIZE = 10;
const MAX_RECEIPTS_PAGE_SIZE = 50;
const KNOWN_STORE_PATTERNS: Array<{
  canonicalName: string;
  aliases: string[];
}> = [
  {
    canonicalName: 'COOP ALLEANZA 3.0',
    aliases: [
      'COOP ALLEANZA 3.0',
      'COOP ALLEANZA',
      'ALLEANZA 3.0',
      'COOP',
      'SUPERMERCATO PADOVA PACE',
      'PADOVA PACE',
    ],
  },
  {
    canonicalName: 'ALIPER DI ABANO',
    aliases: [
      'ALIPER DI ABANO',
      'ALIPER ABANO',
      'ALIPER',
      'ALI PER',
      'ALI',
      'ALI SPA',
      'ALI S P A',
      'ABANO TERME',
    ],
  },
];
const KNOWN_STORE_VAT_TO_NAME: Record<string, string> = {
  '03503411203': 'COOP ALLEANZA 3.0',
  '00348980285': 'ALIPER DI ABANO',
};

@Injectable()
export class SpesaService implements OnModuleInit {
  private readonly logger = new Logger(SpesaService.name);

  constructor(
    private readonly grocyService: GrocyService,
    private readonly receiptParserDispatcher: ReceiptParserDispatcherService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  // Bootstraps and migrates local SQLite structures used by receipt ingestion.
  async onModuleInit(): Promise<void> {
    await this.dataSource.query(`PRAGMA foreign_keys = ON`);

    // Normalized store dimension.
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS stores (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_key TEXT NOT NULL UNIQUE,
        store_name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Snapshot of Grocy products used by mappings and receipt items.
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS grocy_products (
        id INTEGER PRIMARY KEY,
        name_snapshot TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    // Canonical receipt-side product name dictionary.
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS receipt_products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_name_raw TEXT NOT NULL,
        receipt_name_normalized TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS receipt_product_mappings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER NOT NULL,
        receipt_product_id INTEGER NOT NULL,
        grocy_product_id INTEGER NOT NULL,
        confidence REAL NOT NULL DEFAULT 1,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(id),
        FOREIGN KEY (receipt_product_id) REFERENCES receipt_products(id),
        FOREIGN KEY (grocy_product_id) REFERENCES grocy_products(id),
        UNIQUE(store_id, receipt_product_id)
      )
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS spesa_receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        store_id INTEGER NOT NULL,
        purchased_at TEXT NOT NULL,
        source TEXT,
        file_name TEXT,
        subtotal REAL,
        total REAL,
        raw_text TEXT,
        fingerprint TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        FOREIGN KEY (store_id) REFERENCES stores(id)
      )
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS idx_spesa_receipts_store_date
      ON spesa_receipts(store_id, purchased_at)
    `);

    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS spesa_receipt_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_id INTEGER NOT NULL,
        receipt_product_id INTEGER NOT NULL,
        grocy_product_id INTEGER NOT NULL,
        quantity REAL NOT NULL,
        unit_price REAL NOT NULL,
        discount_total REAL NOT NULL,
        line_total_discounted REAL NOT NULL,
        vat_rate REAL NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (receipt_id) REFERENCES spesa_receipts(id),
        FOREIGN KEY (receipt_product_id) REFERENCES receipt_products(id),
        FOREIGN KEY (grocy_product_id) REFERENCES grocy_products(id)
      )
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS idx_spesa_receipt_items_receipt
      ON spesa_receipt_items(receipt_id)
    `);

    await this.dataSource.query(`
      CREATE INDEX IF NOT EXISTS idx_spesa_receipt_items_product
      ON spesa_receipt_items(grocy_product_id)
    `);

    await this.migrateLegacySpesaData();
    await this.dropLegacySpesaTables();
    await this.ensureSpesaReceiptItemsCascadeDelete();
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

    // OCR/PDF selection is delegated to specialized parsers via dispatcher.
    const dispatchResult = await this.receiptParserDispatcher.parse(file);
    this.logger.log(
      `parse.dispatch file=${file.originalname} kind=${dispatchResult.kind} source=${dispatchResult.source} rawTextLen=${dispatchResult.rawText.length}`,
    );

    const rawText = dispatchResult.rawText;
    const items = this.aggregatePreviewItems(
      this.extractItemsFromReceiptText(rawText),
    );
    const storeName = this.extractStoreName(rawText);
    const storeKey = this.normalizeStoreKey(storeName);
    const subtotal = this.extractTotalValue(
      rawText,
      /SUBTOTALE\s+(\d+[.,]\d{2})/i,
    );
    const total = this.extractTotalValue(
      rawText,
      /TOTALE\s+COMPLESSIVO\s+(\d+[.,]\d{2})/i,
    );
    const existingReceiptId = await this.findExistingReceiptByContent({
      storeKey,
      total,
      rawText,
    });

    this.logger.log(
      `parse.summary file=${file.originalname} store=${storeKey} items=${items.length} subtotal=${subtotal ?? 'null'} total=${total ?? 'null'} duplicate=${existingReceiptId !== null}`,
    );

    return {
      fileName: file.originalname,
      mimeType: file.mimetype,
      source: dispatchResult.source,
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
      // Prefer previously approved mappings to minimize repeated manual matching.
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

  async saveMappings(
    request: SaveMappingsRequest,
  ): Promise<SaveMappingsResponse> {
    const mappings = Array.isArray(request.mappings) ? request.mappings : [];
    if (mappings.length === 0) {
      throw new BadRequestException('Nessun mapping da salvare.');
    }

    const storeName = this.normalizeStoreName(request.storeName);
    const storeKey = this.normalizeStoreKey(storeName);
    const now = new Date().toISOString();
    const storeId = await this.ensureStoreId(storeKey, storeName);
    let savedCount = 0;

    for (const mapping of mappings) {
      // Save canonicalized receipt-side names and bind them to Grocy products per store.
      const receiptNameRaw = (mapping.receiptName ?? '').trim();
      const receiptNameNormalized = this.normalizeForMatching(receiptNameRaw);
      const grocyProductId = Number(mapping.grocyProductId);
      const grocyProductName = (mapping.grocyProductName ?? '').trim();
      const confidence = this.normalizeConfidence(mapping.confidence);

      if (
        !receiptNameNormalized ||
        !Number.isInteger(grocyProductId) ||
        !grocyProductName
      ) {
        continue;
      }

      const receiptProductId = await this.ensureReceiptProductId(
        receiptNameRaw,
        receiptNameNormalized,
      );
      await this.upsertGrocyProductSnapshot(grocyProductId, grocyProductName);

      await this.dataSource.query(
        `
          INSERT INTO receipt_product_mappings (
            store_id,
            receipt_product_id,
            grocy_product_id,
            confidence,
            usage_count,
            last_used_at,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
          ON CONFLICT(store_id, receipt_product_id)
          DO UPDATE SET
            grocy_product_id = excluded.grocy_product_id,
            confidence = excluded.confidence,
            usage_count = receipt_product_mappings.usage_count + 1,
            last_used_at = excluded.last_used_at,
            updated_at = excluded.updated_at
        `,
        [storeId, receiptProductId, grocyProductId, confidence, now, now, now],
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

    // Normalize and validate payload rows before touching the database.
    const normalizedItems = items
      .map((item) => {
        const receiptName = (item.receiptName ?? '').trim();
        const receiptNameNormalized = this.normalizeForMatching(receiptName);
        const grocyProductId = Number(item.grocyProductId);
        const grocyProductName = (item.grocyProductName ?? '').trim();
        const quantity = this.normalizePositiveNumber(item.quantity);
        const unitPrice = this.normalizePositiveNumber(item.unitPrice);
        const discountTotal = this.normalizeNonNegativeNumber(
          item.discountTotal,
        );
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

    // Persist receipt + items atomically to avoid partially imported receipts.
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const storeId = await this.ensureStoreId(
        storeKey,
        storeName,
        queryRunner,
      );

      const existingRows = (await queryRunner.query(
        `SELECT id FROM spesa_receipts WHERE fingerprint = ? LIMIT 1`,
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
          INSERT INTO spesa_receipts (
            store_id,
            purchased_at,
            source,
            file_name,
            subtotal,
            total,
            raw_text,
            fingerprint,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          storeId,
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
        throw new BadRequestException(
          "Impossibile determinare l'id dello scontrino salvato.",
        );
      }

      for (const item of normalizedItems) {
        const receiptProductId = await this.ensureReceiptProductId(
          item.receiptName,
          item.receiptNameNormalized,
          queryRunner,
        );

        await this.upsertGrocyProductSnapshot(
          item.grocyProductId,
          item.grocyProductName,
          queryRunner,
        );

        await queryRunner.query(
          `
            INSERT INTO spesa_receipt_items (
              receipt_id,
              receipt_product_id,
              grocy_product_id,
              quantity,
              unit_price,
              discount_total,
              line_total_discounted,
              vat_rate,
              created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            receiptId,
            receiptProductId,
            item.grocyProductId,
            item.quantity,
            item.unitPrice,
            item.discountTotal,
            item.lineTotalDiscounted,
            item.vatRate,
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

  async getStoredReceipts(input: {
    page?: number;
    pageSize?: number;
  }): Promise<StoredReceiptListResponse> {
    const page = this.normalizeReceiptsPage(input.page);
    const pageSize = this.normalizeReceiptsPageSize(input.pageSize);
    const offset = (page - 1) * pageSize;

    const totalRows = await this.queryRows<{ total_items: number | string }>(
      `SELECT COUNT(*) as total_items FROM spesa_receipts`,
      [],
    );
    const totalItems = Number(totalRows[0]?.total_items ?? 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));

    const rows = await this.queryRows<{
      id: number | string;
      store_name: string | null;
      store_key: string | null;
      purchased_at: string;
      source: string | null;
      file_name: string | null;
      subtotal: number | string | null;
      total: number | string | null;
      item_count: number | string;
      created_at: string;
    }>(
      `
        SELECT
          r.id,
          s.store_name,
          s.store_key,
          r.purchased_at,
          r.source,
          r.file_name,
          r.subtotal,
          r.total,
          COUNT(ri.id) as item_count,
          r.created_at
        FROM spesa_receipts r
        INNER JOIN stores s ON s.id = r.store_id
        LEFT JOIN spesa_receipt_items ri ON ri.receipt_id = r.id
        GROUP BY r.id
        ORDER BY r.purchased_at DESC, r.id DESC
        LIMIT ? OFFSET ?
      `,
      [pageSize, offset],
    );

    return {
      page,
      pageSize,
      totalItems,
      totalPages,
      items: rows.map((row) => ({
        id: Number(row.id) || 0,
        storeName: (row.store_name ?? '').trim() || DEFAULT_STORE_NAME,
        storeKey: (row.store_key ?? '').trim() || DEFAULT_STORE_KEY,
        purchasedAt: row.purchased_at,
        source: row.source === 'ocr' ? 'ocr' : 'pdf',
        fileName: row.file_name,
        subtotal:
          row.subtotal === null
            ? null
            : this.roundMoney(Number(row.subtotal) || 0),
        total:
          row.total === null ? null : this.roundMoney(Number(row.total) || 0),
        itemCount: Number(row.item_count) || 0,
        createdAt: row.created_at,
      })),
    };
  }

  async getStoredReceiptDetail(
    receiptId: number,
  ): Promise<StoredReceiptDetailResponse> {
    const normalizedReceiptId = this.normalizeReceiptId(receiptId);

    const receiptRows = await this.queryRows<{
      id: number | string;
      store_name: string | null;
      store_key: string | null;
      purchased_at: string;
      source: string | null;
      file_name: string | null;
      subtotal: number | string | null;
      total: number | string | null;
      item_count: number | string;
      created_at: string;
    }>(
      `
        SELECT
          r.id,
          s.store_name,
          s.store_key,
          r.purchased_at,
          r.source,
          r.file_name,
          r.subtotal,
          r.total,
          COUNT(ri.id) as item_count,
          r.created_at
        FROM spesa_receipts r
        INNER JOIN stores s ON s.id = r.store_id
        LEFT JOIN spesa_receipt_items ri ON ri.receipt_id = r.id
        WHERE r.id = ?
        GROUP BY r.id
        LIMIT 1
      `,
      [normalizedReceiptId],
    );

    const receipt = receiptRows[0];
    if (!receipt) {
      throw new NotFoundException('Scontrino non trovato.');
    }

    const itemRows = await this.queryRows<{
      id: number | string;
      receipt_product_id: number | string;
      receipt_name: string | null;
      grocy_product_id: number | string;
      grocy_product_name: string | null;
      quantity: number | string | null;
      unit_price: number | string | null;
      discount_total: number | string | null;
      line_total_discounted: number | string | null;
      vat_rate: number | string | null;
      created_at: string;
    }>(
      `
        SELECT
          ri.id,
          ri.receipt_product_id,
          rp.receipt_name_raw as receipt_name,
          ri.grocy_product_id,
          COALESCE(gp.name_snapshot, 'Prodotto #' || ri.grocy_product_id) as grocy_product_name,
          ri.quantity,
          ri.unit_price,
          ri.discount_total,
          ri.line_total_discounted,
          ri.vat_rate,
          ri.created_at
        FROM spesa_receipt_items ri
        INNER JOIN receipt_products rp ON rp.id = ri.receipt_product_id
        LEFT JOIN grocy_products gp ON gp.id = ri.grocy_product_id
        WHERE ri.receipt_id = ?
        ORDER BY ri.id ASC
      `,
      [normalizedReceiptId],
    );

    return {
      receipt: {
        id: Number(receipt.id) || 0,
        storeName: (receipt.store_name ?? '').trim() || DEFAULT_STORE_NAME,
        storeKey: (receipt.store_key ?? '').trim() || DEFAULT_STORE_KEY,
        purchasedAt: receipt.purchased_at,
        source: receipt.source === 'ocr' ? 'ocr' : 'pdf',
        fileName: receipt.file_name,
        subtotal:
          receipt.subtotal === null
            ? null
            : this.roundMoney(Number(receipt.subtotal) || 0),
        total:
          receipt.total === null
            ? null
            : this.roundMoney(Number(receipt.total) || 0),
        itemCount: Number(receipt.item_count) || 0,
        createdAt: receipt.created_at,
      },
      items: itemRows.map((row) => ({
        id: Number(row.id) || 0,
        receiptProductId: Number(row.receipt_product_id) || 0,
        receiptName: (row.receipt_name ?? '').trim(),
        grocyProductId: Number(row.grocy_product_id) || 0,
        grocyProductName:
          (row.grocy_product_name ?? '').trim() ||
          `Prodotto #${String(row.grocy_product_id)}`,
        quantity: this.roundMoney(Number(row.quantity) || 0),
        unitPrice: this.roundMoney(Number(row.unit_price) || 0),
        discountTotal: this.roundMoney(Number(row.discount_total) || 0),
        lineTotalDiscounted: this.roundMoney(
          Number(row.line_total_discounted) || 0,
        ),
        vatRate: this.roundMoney(Number(row.vat_rate) || 0),
        createdAt: row.created_at,
      })),
    };
  }

  async deleteStoredReceipt(
    receiptId: number,
  ): Promise<DeleteStoredReceiptResponse> {
    const normalizedReceiptId = this.normalizeReceiptId(receiptId);

    const existingRows = await this.queryRows<ExistingReceiptRow>(
      `SELECT id FROM spesa_receipts WHERE id = ? LIMIT 1`,
      [normalizedReceiptId],
    );
    if (!existingRows[0]) {
      throw new NotFoundException('Scontrino non trovato.');
    }

    const itemsCountRows = await this.queryRows<{
      total_items: number | string;
    }>(
      `SELECT COUNT(*) as total_items FROM spesa_receipt_items WHERE receipt_id = ?`,
      [normalizedReceiptId],
    );
    const deletedItemsCount = Number(itemsCountRows[0]?.total_items ?? 0);

    await this.dataSource.query(`DELETE FROM spesa_receipts WHERE id = ?`, [
      normalizedReceiptId,
    ]);

    const changesRows = await this.queryRows<{ count: number | string }>(
      `SELECT changes() as count`,
      [],
    );
    const deletedReceipt = Number(changesRows[0]?.count ?? 0) > 0;

    if (!deletedReceipt) {
      throw new NotFoundException('Scontrino non trovato.');
    }

    return {
      receiptId: normalizedReceiptId,
      deletedReceipt,
      deletedItemsCount,
    };
  }

  async getShoppingInsights(input: {
    days?: number;
    productIds?: number[];
  }): Promise<ShoppingInsightsResponse> {
    // Build dashboard aggregates from normalized receipts and item price points.
    const periodDays = this.normalizeInsightsPeriodDays(input.days);
    const selectedProductIds = Array.isArray(input.productIds)
      ? input.productIds.filter((value) => Number.isInteger(value) && value > 0)
      : [];
    const selectedProductIdsUnique = [...new Set(selectedProductIds)].slice(
      0,
      12,
    );
    const periodStart = new Date(
      Date.now() - periodDays * 24 * 60 * 60 * 1000,
    ).toISOString();

    const overviewRows = await this.queryRows<ShoppingInsightsOverviewRow>(
      `
        SELECT
          COUNT(*) as receipts_count,
          COALESCE(SUM(total), 0) as total_spent,
          COALESCE(AVG(total), 0) as average_receipt_total
        FROM spesa_receipts
        WHERE purchased_at >= ?
      `,
      [periodStart],
    );

    const monthlyTotalsRows =
      await this.queryRows<ShoppingInsightsMonthlyTotalRow>(
        `
        SELECT
          substr(purchased_at, 1, 7) as month,
          COALESCE(SUM(total), 0) as total_spent
        FROM spesa_receipts
        WHERE purchased_at >= ?
        GROUP BY substr(purchased_at, 1, 7)
        ORDER BY month ASC
      `,
        [periodStart],
      );

    const monthlyReceiptsRows =
      await this.queryRows<ShoppingInsightsMonthlyReceiptRow>(
        `
        SELECT
          substr(purchased_at, 1, 7) as month,
          COUNT(*) as receipts_count,
          COALESCE(AVG(total), 0) as average_receipt_total
        FROM spesa_receipts
        WHERE purchased_at >= ?
        GROUP BY substr(purchased_at, 1, 7)
        ORDER BY month ASC
      `,
        [periodStart],
      );

    const topProductsRows = await this.queryRows<ShoppingInsightsTopProductRow>(
      `
        SELECT
          ri.grocy_product_id,
          COALESCE(MAX(gp.name_snapshot), 'Prodotto #' || ri.grocy_product_id) as grocy_product_name,
          COALESCE(SUM(ri.line_total_discounted), 0) as total_spent,
          COALESCE(AVG(ri.unit_price), 0) as average_unit_price,
          COALESCE(MIN(ri.unit_price), 0) as min_unit_price,
          COALESCE(MAX(ri.unit_price), 0) as max_unit_price,
          COALESCE((
            SELECT ri2.unit_price
            FROM spesa_receipt_items ri2
            INNER JOIN spesa_receipts r2 ON r2.id = ri2.receipt_id
            WHERE ri2.grocy_product_id = ri.grocy_product_id
              AND r2.purchased_at >= ?
            ORDER BY r2.purchased_at DESC, ri2.id DESC
            LIMIT 1
          ), 0) as last_unit_price,
          COUNT(*) as observations
        FROM spesa_receipt_items ri
        INNER JOIN spesa_receipts r ON r.id = ri.receipt_id
        LEFT JOIN grocy_products gp ON gp.id = ri.grocy_product_id
        WHERE r.purchased_at >= ?
        GROUP BY ri.grocy_product_id
        ORDER BY total_spent DESC
        LIMIT ?
      `,
      [periodStart, periodStart, TOP_PRODUCTS_LIMIT],
    );

    const topProductIds = topProductsRows
      .map((row) => Number(row.grocy_product_id))
      .filter((productId) => Number.isInteger(productId) && productId > 0);

    const medianByProductId = new Map<number, number>();
    if (topProductIds.length > 0) {
      const placeholders = topProductIds.map(() => '?').join(', ');
      const medianRows = await this.queryRows<ProductMedianRow>(
        `
          SELECT grocy_product_id, unit_price
          FROM spesa_receipt_items ri
          INNER JOIN spesa_receipts r ON r.id = ri.receipt_id
          WHERE r.purchased_at >= ?
            AND grocy_product_id IN (${placeholders})
          ORDER BY grocy_product_id ASC, unit_price ASC
        `,
        [periodStart, ...topProductIds],
      );

      const valuesByProductId = new Map<number, number[]>();
      for (const row of medianRows) {
        const productId = Number(row.grocy_product_id);
        const unitPrice = Number(row.unit_price);
        if (
          !Number.isInteger(productId) ||
          productId <= 0 ||
          !Number.isFinite(unitPrice)
        ) {
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
      trendRows = await this.queryRows<ShoppingInsightsTrendRow>(
        `
          SELECT
            ri.grocy_product_id,
            COALESCE(MAX(gp.name_snapshot), 'Prodotto #' || ri.grocy_product_id) as grocy_product_name,
            r.purchased_at as observed_at,
            ri.receipt_id,
            ri.unit_price,
            ri.quantity,
            ri.line_total_discounted
          FROM spesa_receipt_items ri
          INNER JOIN spesa_receipts r ON r.id = ri.receipt_id
          LEFT JOIN grocy_products gp ON gp.id = ri.grocy_product_id
          WHERE r.purchased_at >= ?
            AND ri.grocy_product_id IN (${placeholders})
          GROUP BY ri.id
          ORDER BY ri.grocy_product_id ASC, r.purchased_at ASC, ri.id ASC
        `,
        [periodStart, ...selectedProductIdsUnique],
      );
    }

    const selectedProductsTrendById = new Map<
      number,
      ShoppingInsightsProductTrend
    >();
    for (const row of trendRows) {
      const productId = Number(row.grocy_product_id);
      if (!Number.isInteger(productId) || productId <= 0) {
        continue;
      }

      if (!selectedProductsTrendById.has(productId)) {
        selectedProductsTrendById.set(productId, {
          grocyProductId: productId,
          grocyProductName:
            (row.grocy_product_name ?? '').trim() || `Prodotto #${productId}`,
          points: [],
        });
      }

      selectedProductsTrendById.get(productId)?.points.push({
        observedAt: row.observed_at,
        receiptId: Number(row.receipt_id) || 0,
        unitPrice: this.roundMoney(Number(row.unit_price) || 0),
        quantity: this.roundMoney(Number(row.quantity) || 0),
        lineTotalDiscounted: this.roundMoney(
          Number(row.line_total_discounted) || 0,
        ),
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
        averageReceiptTotal: this.roundMoney(
          Number(row.average_receipt_total ?? 0),
        ),
      })),
      topProductsBySpend: topProductsRows.map((row) => ({
        grocyProductId: Number(row.grocy_product_id),
        grocyProductName:
          (row.grocy_product_name ?? '').trim() ||
          `Prodotto #${String(row.grocy_product_id)}`,
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

  private extractItemsFromReceiptText(rawText: string): ParsedReceiptItem[] {
    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const items: ParsedReceiptItem[] = [];
    let inItemsSection = false;
    let seenReceiptHeader = false;
    let previousItem: ParsedReceiptItem | null = null;
    let previousNormalizedLine: string | null = null;
    const sectionLines: string[] = [];

    // First pass: parse line-oriented receipts where product, VAT and price stay aligned.
    for (const line of lines) {
      const normalizedLine = line.replace(/\s+/g, ' ').trim();
      const lineForParsing = this.normalizeOcrLineForParsing(normalizedLine);

      if (/DOCUMENTO|COMMERCIALE|VENDITA|PRESTAZIONE/i.test(normalizedLine)) {
        seenReceiptHeader = true;
      }

      if (this.isLikelyItemsHeader(lineForParsing)) {
        inItemsSection = true;
        continue;
      }

      if (!inItemsSection) {
        if (
          seenReceiptHeader &&
          this.isLikelyReceiptItemCandidate(lineForParsing)
        ) {
          inItemsSection = true;
        } else {
          continue;
        }
      }

      if (
        /^(SUBTOTALE|TOTALE\s+COMPLESSIVO|DI\s+CUI\s+IVA|IMP\.?\s*PAGATO|PAGAMENTO)/i.test(
          lineForParsing,
        )
      ) {
        if (inItemsSection) {
          break;
        }
        continue;
      }

      sectionLines.push(lineForParsing);

      const quantityMatch = lineForParsing.match(QUANTITY_HINT_REGEX);
      if (quantityMatch?.groups) {
        previousNormalizedLine = lineForParsing;
        continue;
      }

      const parsedLine = this.parseReceiptItemLine(lineForParsing);
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
        previousNormalizedLine = lineForParsing;
        continue;
      }

      const previousLineQuantityMatch =
        previousNormalizedLine?.match(QUANTITY_HINT_REGEX);
      let quantity = 1;
      let unitPrice = parsedPrice;
      let totalPrice = parsedPrice;

      if (previousLineQuantityMatch?.groups) {
        const hintedQuantity = Number(
          previousLineQuantityMatch.groups.quantity,
        );
        const hintedUnitPrice = this.parseMoneyValue(
          previousLineQuantityMatch.groups.unitPrice,
        );

        if (hintedQuantity > 1) {
          quantity = hintedQuantity;
          unitPrice = hintedUnitPrice;
          totalPrice = parsedPrice;
        }
      }

      const normalizedName = this.normalizeProductName(rawName);
      if (!this.isLikelyProductName(rawName, normalizedName, true)) {
        previousNormalizedLine = lineForParsing;
        continue;
      }

      const item: ParsedReceiptItem = {
        name: normalizedName,
        rawName,
        quantity,
        unitPrice,
        totalPrice,
        vatRate: parsedVatRate,
        discountTotal: 0,
      };

      items.push(item);
      previousItem = item;
      previousNormalizedLine = lineForParsing;
    }

    // Second pass: fallback for OCR text with collapsed spacing/line breaks.
    const sectionCompactItems = this.extractItemsFromCompactReceiptText(
      sectionLines.join(' '),
    );
    const sectionPriceTokenCount = this.countLoosePriceTokens(
      sectionLines.join(' '),
    );

    if (
      sectionCompactItems.length > items.length &&
      sectionCompactItems.length <= sectionPriceTokenCount + 2
    ) {
      return sectionCompactItems;
    }

    if (items.length === 0) {
      return this.extractItemsFromCompactReceiptText(rawText);
    }

    return items;
  }

  private aggregatePreviewItems(
    items: ParsedReceiptItem[],
  ): ParsedReceiptItem[] {
    if (items.length <= 1) {
      return items;
    }

    const aggregated = new Map<string, ParsedReceiptItem>();
    const order: string[] = [];

    for (const item of items) {
      const key = [
        this.normalizeForMatching(item.name),
        this.roundMoney(item.unitPrice).toFixed(2),
        this.roundMoney(item.vatRate).toFixed(2),
      ].join('|');

      const existing = aggregated.get(key);
      if (!existing) {
        aggregated.set(key, {
          ...item,
          quantity: this.roundMoney(item.quantity),
          totalPrice: this.roundMoney(item.totalPrice),
          discountTotal: this.roundMoney(item.discountTotal),
        });
        order.push(key);
        continue;
      }

      existing.quantity = this.roundMoney(existing.quantity + item.quantity);
      existing.totalPrice = this.roundMoney(
        existing.totalPrice + item.totalPrice,
      );
      existing.discountTotal = this.roundMoney(
        existing.discountTotal + item.discountTotal,
      );
    }

    return order
      .map((key) => aggregated.get(key))
      .filter((item): item is ParsedReceiptItem => item !== undefined);
  }

  private extractItemsFromCompactReceiptText(
    rawText: string,
  ): ParsedReceiptItem[] {
    const compactText = this.normalizeOcrLineForParsing(
      rawText.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim(),
    );

    if (!compactText) {
      return [];
    }

    // Two staged regexes: strict first, then looser pattern for noisier OCR output.
    const strictPattern =
      /(?<name>[A-Z0-9 .,'/-]{3,}?)\s+(?:CF\s+)?(?<vatRate>\d{1,2}[.,]\d{1,2})\s*%?\s+(?<price>-?\d+[.,]\d{2})(?=\s+(?:[A-Z]|SUBTOTALE|TOTALE|PAGAMENTO|IMPORTO)|$)/gi;
    const loosePattern =
      /(?<name>[A-Z0-9 .,'/-]{3,90}?)\s+(?:(?:CF\s+)?(?<vatRate>\d{1,2}[.,]\d{1,2})\s*%?\s+)?(?<price>-?\d{3,5}|-?\d+[.,]\d{2})(?=\s+(?:[A-Z]{2,}|SUBTOTALE|TOTALE|PAGAMENTO|IMPORTO)|$)/gi;
    const items: ParsedReceiptItem[] = [];
    let match: RegExpExecArray | null;

    while ((match = strictPattern.exec(compactText)) !== null) {
      const parsedItem = this.buildCompactParsedItem(match.groups ?? null);
      if (!parsedItem) {
        continue;
      }

      items.push(parsedItem);

      if (items.length >= 120) {
        break;
      }
    }

    if (items.length > 0) {
      return items;
    }

    while ((match = loosePattern.exec(compactText)) !== null) {
      const parsedItem = this.buildCompactParsedItem(match.groups ?? null);
      if (!parsedItem) {
        continue;
      }

      items.push(parsedItem);

      if (items.length >= 120) {
        break;
      }
    }

    if (items.length > 0) {
      return items;
    }

    return this.extractItemsFromPriceAnchors(compactText);
  }

  private extractItemsFromPriceAnchors(
    compactText: string,
  ): ParsedReceiptItem[] {
    // Last-resort heuristic: anchor on price tokens and backtrack a plausible name chunk.
    const items: ParsedReceiptItem[] = [];
    const stopWordsPattern =
      /^(DOCUMENTO|DESCRIZIONE|P\.I\.?|VIA|TEL|PAGAMENTO|IMPORTO|SUBTOTALE|TOTALE|NR|CAP)$/i;
    const pricePattern = /-?\d+[.,]\d{2}|-?\d{3,5}/g;
    const priceMatches = [...compactText.matchAll(pricePattern)];

    for (const match of priceMatches) {
      const rawPrice = match[0] ?? '';
      const parsedPrice = this.parseLooseMoneyValue(rawPrice);
      if (!parsedPrice || parsedPrice <= 0 || parsedPrice > 999) {
        continue;
      }

      const matchIndex = match.index ?? 0;
      const leftWindowStart = Math.max(0, matchIndex - 96);
      const leftWindow = compactText.slice(leftWindowStart, matchIndex).trim();
      if (!leftWindow) {
        continue;
      }

      const vatMatch = leftWindow.match(
        /(?:CF\s*)?(?<vatRate>\d{1,2}[.,]\d{1,2})\s*%?\s*$/i,
      );
      const vatRate = vatMatch?.groups?.vatRate
        ? this.parsePercentValue(vatMatch.groups.vatRate)
        : 0;

      const nameChunk = leftWindow
        .replace(/(?:CF\s*)?\d{1,2}[.,]\d{1,2}\s*%?\s*$/i, '')
        .trim();
      const tokenCandidates = nameChunk
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .slice(-10);
      const rawName = tokenCandidates.join(' ').trim();

      if (!rawName || rawName.length < 3) {
        continue;
      }

      if (stopWordsPattern.test(rawName)) {
        continue;
      }

      const normalizedName = this.normalizeProductName(rawName);
      if (!this.isLikelyProductName(rawName, normalizedName, false)) {
        continue;
      }

      items.push({
        name: normalizedName,
        rawName,
        quantity: 1,
        unitPrice: parsedPrice,
        totalPrice: parsedPrice,
        vatRate,
        discountTotal: 0,
      });

      if (items.length >= 120) {
        break;
      }
    }

    return items;
  }

  private buildCompactParsedItem(
    groups: Record<string, string> | null,
  ): ParsedReceiptItem | null {
    if (!groups) {
      return null;
    }

    const rawName = (groups.name ?? '').replace(/\s+/g, ' ').trim();
    if (!rawName || rawName.length < 3) {
      return null;
    }

    if (
      /^(DOCUMENTO|DESCRIZIONE|P\.I\.?|VIA|TEL|PAGAMENTO|IMPORTO|SUBTOTALE|TOTALE)/i.test(
        rawName,
      )
    ) {
      return null;
    }

    const parsedPrice = this.parseLooseMoneyValue(groups.price ?? '');
    if (!parsedPrice || parsedPrice <= 0 || parsedPrice > 999) {
      return null;
    }

    const parsedVatRate = groups.vatRate
      ? this.parsePercentValue(groups.vatRate)
      : 0;
    const normalizedName = this.normalizeProductName(rawName);
    if (!this.isLikelyProductName(rawName, normalizedName, false)) {
      return null;
    }

    return {
      name: normalizedName,
      rawName,
      quantity: 1,
      unitPrice: parsedPrice,
      totalPrice: parsedPrice,
      vatRate: parsedVatRate,
      discountTotal: 0,
    };
  }

  private parseLooseMoneyValue(rawValue: string): number | null {
    const token = this.sanitizeNumericToken(rawValue)
      .replace(/\s+/g, '')
      .trim();
    if (!token) {
      return null;
    }

    if (/^-?\d+[.,]\d{2}$/.test(token)) {
      return this.parseMoneyValue(token);
    }

    if (/^-?\d{3,5}$/.test(token)) {
      const sign = token.startsWith('-') ? -1 : 1;
      const digits = Number(token.replace('-', ''));
      if (!Number.isFinite(digits)) {
        return null;
      }

      return this.roundMoney((digits / 100) * sign);
    }

    return null;
  }

  private countLoosePriceTokens(text: string): number {
    if (!text) {
      return 0;
    }

    return (text.match(/-?\d+[.,]\d{2}|-?\d{3,5}/g) ?? []).length;
  }

  private isLikelyItemsHeader(normalizedLine: string): boolean {
    return /DESCRIZ|DESCRIZIONE|IVA\s+PREZZO|PREZZO\s*\(?E\)?/i.test(
      normalizedLine,
    );
  }

  private isLikelyReceiptItemCandidate(normalizedLine: string): boolean {
    const parsedLine = this.parseReceiptItemLine(normalizedLine);
    if (!parsedLine) {
      return false;
    }

    if (parsedLine.rawName.length < 3) {
      return false;
    }

    if (
      /^(TEL|P\.I\.?|VIA|CAP|DOCUMENTO|PAGAMENTO|IMPORTO)/i.test(
        parsedLine.rawName,
      )
    ) {
      return false;
    }

    return parsedLine.price > 0;
  }

  private normalizeOcrLineForParsing(line: string): string {
    return line
      .replace(/[€]/g, 'E')
      .replace(/([0-9])[OQ](?=[0-9.,])/g, '$10')
      .replace(/([0-9.,])[OQ](?=[0-9])/g, '$10')
      .replace(/([0-9])[IL](?=[0-9.,])/g, '$11')
      .replace(/([0-9.,])[IL](?=[0-9])/g, '$11')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private parseReceiptItemLine(normalizedLine: string): {
    rawName: string;
    price: number;
    vatRate: number;
  } | null {
    // Prefer canonical "name + vat + price" rows, then fallback to trailing price extraction.
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

    const fallbackPriceMatch = normalizedLine.match(
      /(?<price>-?\d+[.,]\d{2}|-?\d{3,5})\s*$/,
    );
    if (!fallbackPriceMatch?.groups?.price) {
      return null;
    }

    const price = this.parseLooseMoneyValue(fallbackPriceMatch.groups.price);
    if (!price || price <= 0 || price > 999) {
      return null;
    }

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

    if (
      /^(SUBTOTALE|TOTALE\s+COMPLESSIVO|DI\s+CUI\s+IVA|PAGAMENTO)/i.test(
        rawName,
      )
    ) {
      return null;
    }

    return {
      rawName,
      price,
      vatRate,
    };
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
    const rows = await this.queryRows<StoredMappingRow>(
      `
        SELECT
          rpm.grocy_product_id,
          gp.name_snapshot as grocy_product_name_snapshot,
          rpm.confidence
        FROM receipt_product_mappings rpm
        INNER JOIN stores s ON s.id = rpm.store_id
        INNER JOIN receipt_products rp ON rp.id = rpm.receipt_product_id
        LEFT JOIN grocy_products gp ON gp.id = rpm.grocy_product_id
        WHERE s.store_key = ?
          AND rp.receipt_name_normalized = ?
        LIMIT 1
      `,
      [storeKey, receiptNameNormalized],
    );

    return rows[0] ?? null;
  }

  private findGrocyCandidates(
    receiptNameNormalized: string,
    products: GrocyProductLite[],
  ): MatchCandidate[] {
    // Compute ranked fuzzy candidates, then return only the top few actionable options.
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
    // Hybrid lexical score: token overlap + edit-distance similarity + containment bonus.
    if (!leftName || !rightName) {
      return 0;
    }

    const overlapCount = [...leftTokens].filter((token) =>
      rightTokens.has(token),
    ).length;
    const unionCount = new Set([...leftTokens, ...rightTokens]).size;
    const tokenScore = unionCount > 0 ? overlapCount / unionCount : 0;

    const maxLength = Math.max(leftName.length, rightName.length);
    const distance = this.levenshteinDistance(leftName, rightName);
    const charScore = maxLength > 0 ? 1 - distance / maxLength : 0;

    const containsBonus =
      leftName.includes(rightName) || rightName.includes(leftName) ? 0.08 : 0;

    return Math.min(
      1,
      Math.max(0, tokenScore * 0.65 + charScore * 0.35 + containsBonus),
    );
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
    // Resolve known stores first, then fallback to a robust header heuristic.
    const knownStoreByVat = this.resolveKnownStoreNameByVat(rawText);
    if (knownStoreByVat) {
      return knownStoreByVat;
    }

    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    const knownStoreName = this.resolveKnownStoreName(lines);
    if (knownStoreName) {
      return knownStoreName;
    }

    const fuzzyTokenStoreName = this.resolveKnownStoreNameByTokenHints(rawText);
    if (fuzzyTokenStoreName) {
      return fuzzyTokenStoreName;
    }

    const inferredStoreName = this.resolveStoreNameFromHeader(lines);
    if (inferredStoreName) {
      return inferredStoreName;
    }

    let bestLine = '';
    let bestScore = -1;

    for (const line of lines.slice(0, 14)) {
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

      if (!/[A-Z]/i.test(line)) {
        continue;
      }

      let score = 0;
      if (!/\d/.test(line)) {
        score += 2;
      }
      if (line.length >= 2 && line.length <= 26) {
        score += 2;
      }
      if (line.split(' ').length <= 4) {
        score += 1;
      }
      if (
        /ALI|ALIPER|IPER|SUPERMERCAT|MARKET|COOP|LIDL|EUROSPIN/i.test(upper)
      ) {
        score += 3;
      }
      if (/S\.P\.A|S\.R\.L|SRL|SPA/.test(upper)) {
        score -= 2;
      }
      if (line.length > 42) {
        score -= 3;
      }

      if (score > bestScore) {
        bestScore = score;
        bestLine = line;
      }
    }

    if (bestLine) {
      return bestLine;
    }

    return DEFAULT_STORE_NAME;
  }

  private resolveStoreNameFromHeader(lines: string[]): string | null {
    const headerCandidates: string[] = [];

    // Focus on the top section before item/payment details start.
    for (const line of lines.slice(0, 36)) {
      const upper = line.toUpperCase();

      if (
        /^(DOCUMENTO|DESCRIZIONE|SUBTOTALE|TOTALE|PAGAMENTO|IMPORTO|ART\b|TRANSAZIONE\b|NR\.\s*CARTA)/.test(
          upper,
        )
      ) {
        break;
      }

      headerCandidates.push(line);
    }

    let bestLine = '';
    let bestScore = -100;

    for (const line of headerCandidates) {
      const score = this.scoreStoreHeaderLine(line);
      if (score > bestScore) {
        bestScore = score;
        bestLine = line;
      }
    }

    if (!bestLine || bestScore < 3) {
      return null;
    }

    // Trim frequent legal suffixes that add noise to store keys while keeping brand name.
    return bestLine
      .replace(/\bSOC\.?\s*COOP\.?\b/gi, '')
      .replace(/\bS\.?R\.?L\.?\b/gi, '')
      .replace(/\bS\.?P\.?A\.?\b/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  private scoreStoreHeaderLine(line: string): number {
    const upper = line.toUpperCase();

    if (!/[A-Z]/i.test(line)) {
      return -20;
    }

    if (line.length < 3) {
      return -20;
    }

    if (
      /^(P\.?I\.?|C\.?F\.?|VIA\b|V\.?LE\b|PIAZZA\b|CORSO\b|TEL\b|CAP\b|DATA\b|ORA\b|RT\b|PUNTO\s+CASSA\b|AUT\.?\b|ID\s*TR\b|A\.?I\.?I\.?C\.?\b)/.test(
        upper,
      )
    ) {
      return -25;
    }

    let score = 0;

    if (!/\d/.test(line)) {
      score += 3;
    }

    if (line.length >= 4 && line.length <= 42) {
      score += 3;
    }

    if (line.split(' ').length <= 6) {
      score += 1;
    }

    if (/[A-Z]{3,}/.test(upper)) {
      score += 2;
    }

    if (
      /COOP|CONAD|LIDL|EUROSPIN|CARREFOUR|IPER|ALI|ALIPER|DESPAR|MD\b|PAM|SUPERMERCAT|MARKET|FAMILA|PENNY/i.test(
        upper,
      )
    ) {
      score += 4;
    }

    if (/S\.P\.A|S\.R\.L|SOC\.\s*COOP/.test(upper)) {
      score += 1;
    }

    if (line.length > 52) {
      score -= 4;
    }

    return score;
  }

  private resolveKnownStoreNameByVat(rawText: string): string | null {
    const digitsOnly = rawText.replace(/\D/g, '');

    // Pass 1: exact VAT hit across all known stores (most reliable and deterministic).
    for (const [vat, storeName] of Object.entries(KNOWN_STORE_VAT_TO_NAME)) {
      if (digitsOnly.includes(vat)) {
        return storeName;
      }
    }

    // Pass 2: approximate VAT match as fallback for noisy OCR digits.
    for (const [vat, storeName] of Object.entries(KNOWN_STORE_VAT_TO_NAME)) {
      if (this.containsApproximateDigitSequence(digitsOnly, vat, 2)) {
        return storeName;
      }
    }

    return null;
  }

  private containsApproximateDigitSequence(
    haystackDigits: string,
    targetDigits: string,
    maxDistance: number,
  ): boolean {
    const targetLength = targetDigits.length;
    if (targetLength === 0 || haystackDigits.length < targetLength - 1) {
      return false;
    }

    const candidateLengths = [
      Math.max(1, targetLength - 1),
      targetLength,
      targetLength + 1,
    ];

    for (const candidateLength of candidateLengths) {
      if (candidateLength > haystackDigits.length) {
        continue;
      }

      for (
        let index = 0;
        index <= haystackDigits.length - candidateLength;
        index += 1
      ) {
        const candidate = haystackDigits.slice(index, index + candidateLength);
        const distance = this.levenshteinDistance(candidate, targetDigits);
        if (distance <= maxDistance) {
          return true;
        }
      }
    }

    return false;
  }

  private resolveKnownStoreName(lines: string[]): string | null {
    const headerLines = lines.slice(0, 24);
    if (headerLines.length === 0) {
      return null;
    }

    const headerText = this.normalizeForMatching(headerLines.join(' '));
    const normalizedLines = headerLines
      .map((line) => this.normalizeForMatching(line))
      .filter(Boolean);

    if (!headerText && normalizedLines.length === 0) {
      return null;
    }

    const headerTokens = this.toTokenSet(headerText);
    let bestMatch: { canonicalName: string; score: number } | null = null;

    // Evaluate aliases against both full header text and individual header lines.
    for (const pattern of KNOWN_STORE_PATTERNS) {
      let patternBestScore = 0;

      for (const alias of pattern.aliases) {
        const normalizedAlias = this.normalizeForMatching(alias);
        if (!normalizedAlias) {
          continue;
        }

        const aliasTokens = this.toTokenSet(normalizedAlias);
        if (headerText) {
          let score = this.computeSimilarityScore(
            headerText,
            headerTokens,
            normalizedAlias,
            aliasTokens,
          );
          if (headerText.includes(normalizedAlias)) {
            score = Math.min(1, score + 0.2);
          }
          patternBestScore = Math.max(patternBestScore, score);
        }

        for (const normalizedLine of normalizedLines) {
          const lineTokens = this.toTokenSet(normalizedLine);
          let score = this.computeSimilarityScore(
            normalizedLine,
            lineTokens,
            normalizedAlias,
            aliasTokens,
          );
          if (normalizedLine.includes(normalizedAlias)) {
            score = Math.min(1, score + 0.3);
          }
          patternBestScore = Math.max(patternBestScore, score);
        }
      }

      if (!bestMatch || patternBestScore > bestMatch.score) {
        bestMatch = {
          canonicalName: pattern.canonicalName,
          score: patternBestScore,
        };
      }
    }

    if (bestMatch && bestMatch.score >= 0.44) {
      return bestMatch.canonicalName;
    }

    return null;
  }

  private resolveKnownStoreNameByTokenHints(rawText: string): string | null {
    const normalizedText = this.normalizeForMatching(rawText);
    if (!normalizedText) {
      return null;
    }

    const tokens = normalizedText
      .split(' ')
      .filter((token) => token.length >= 3);
    if (tokens.length === 0) {
      return null;
    }

    let bestMatch: { canonicalName: string; score: number } | null = null;

    for (const pattern of KNOWN_STORE_PATTERNS) {
      let score = 0;
      for (const alias of pattern.aliases) {
        const aliasTokens = this.normalizeForMatching(alias)
          .split(' ')
          .filter((token) => token.length >= 2);

        for (const aliasToken of aliasTokens) {
          const hasNearToken = tokens.some((token) => {
            if (token === aliasToken) {
              return true;
            }

            if (Math.abs(token.length - aliasToken.length) > 1) {
              return false;
            }

            return this.levenshteinDistance(token, aliasToken) <= 1;
          });

          if (hasNearToken) {
            score += aliasToken.length >= 5 ? 2 : 1;
          }
        }
      }

      if (!bestMatch || score > bestMatch.score) {
        bestMatch = {
          canonicalName: pattern.canonicalName,
          score,
        };
      }
    }

    if (bestMatch && bestMatch.score >= 3) {
      return bestMatch.canonicalName;
    }

    return null;
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
    const trimmed = this.sanitizeNumericToken(rawValue).trim();
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
    const normalized = this.sanitizeNumericToken(rawValue)
      .replace(',', '.')
      .trim();
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private sanitizeNumericToken(rawValue: string): string {
    return rawValue.replace(/[OQ]/gi, '0').replace(/[Il]/g, '1');
  }

  private normalizeProductName(rawName: string): string {
    const withoutPrefix = rawName
      .replace(/^[A-Z]-[A-Z]\s+/i, '')
      .replace(/^[A-Z]-/i, '')
      .replace(/^[A-Z]\s+/i, '');

    return withoutPrefix
      .replace(/[^A-Za-z0-9\s.'/-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private isLikelyProductName(
    rawName: string,
    normalizedName: string,
    strict: boolean,
  ): boolean {
    if (!normalizedName || normalizedName.length < 2) {
      return false;
    }

    const letters = (normalizedName.match(/[A-Za-z]/g) ?? []).length;
    const digits = (normalizedName.match(/\d/g) ?? []).length;
    if (letters < 2) {
      return false;
    }

    const normalizedUpper = this.normalizeForMatching(normalizedName);
    if (
      /^(DOCUMENTO|DESCRIZIONE|P I|VIA|TEL|PAGAMENTO|IMPORTO|SUBTOTALE|TOTALE|COMPLESSIVO)$/.test(
        normalizedUpper,
      )
    ) {
      return false;
    }

    const normalizedTokens = normalizedUpper.split(' ').filter(Boolean);
    if (normalizedTokens.length === 0) {
      return false;
    }

    const hasWordLikeToken = normalizedTokens.some(
      (token) => token.length >= 3,
    );
    if (!hasWordLikeToken && letters < 4) {
      return false;
    }

    if (!strict) {
      return true;
    }

    const rawTrimmed = rawName.trim();
    const badChars = (rawTrimmed.match(/[^A-Za-z0-9\s.'/-]/g) ?? []).length;
    const signalChars = Math.max(1, letters + digits);
    if (badChars / signalChars > 0.6) {
      return false;
    }

    return true;
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
    // Duplicate detection combines normalized OCR text and rounded total inside same store.
    const rows = await this.queryRows<ExistingReceiptCandidateRow>(
      `
        SELECT nr.id, nr.raw_text, nr.total
        FROM spesa_receipts nr
        INNER JOIN stores s ON s.id = nr.store_id
        WHERE s.store_key = ?
        ORDER BY nr.id DESC
        LIMIT 250
      `,
      [input.storeKey],
    );

    if (rows.length === 0) {
      return null;
    }

    const normalizedIncomingText = this.normalizeReceiptRawText(input.rawText);
    const roundedIncomingTotal =
      input.total === null ? null : this.roundMoney(input.total);

    for (const row of rows) {
      const normalizedStoredText = this.normalizeReceiptRawText(
        row.raw_text ?? '',
      );
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

  private async migrateLegacySpesaData(): Promise<void> {
    // One-shot compatibility migration from legacy/pre-normalized tables.
    const hasLegacyMapping = await this.tableExists('receipt_product_mapping');
    const hasLegacyReceipts = await this.tableExists('receipts');
    const hasLegacyItems = await this.tableExists('receipt_items');
    const hasPrefixedReceipts = await this.tableExists('normalized_receipts');
    const hasPrefixedItems = await this.tableExists('normalized_receipt_items');

    if (
      !hasLegacyMapping &&
      !hasLegacyReceipts &&
      !hasLegacyItems &&
      !hasPrefixedReceipts &&
      !hasPrefixedItems
    ) {
      return;
    }

    const now = new Date().toISOString();

    if (hasLegacyMapping) {
      await this.dataSource.query(
        `
          INSERT OR IGNORE INTO stores (store_key, store_name, created_at, updated_at)
          SELECT DISTINCT store_key, store_name, ?, ?
          FROM receipt_product_mapping
        `,
        [now, now],
      );
    }

    if (hasLegacyReceipts) {
      await this.dataSource.query(
        `
          INSERT OR IGNORE INTO stores (store_key, store_name, created_at, updated_at)
          SELECT DISTINCT store_key, store_name, ?, ?
          FROM receipts
        `,
        [now, now],
      );
    }

    if (hasLegacyMapping) {
      await this.dataSource.query(
        `
          INSERT OR IGNORE INTO receipt_products (
            receipt_name_raw,
            receipt_name_normalized,
            created_at,
            updated_at
          )
          SELECT DISTINCT receipt_name_raw, receipt_name_normalized, ?, ?
          FROM receipt_product_mapping
        `,
        [now, now],
      );
    }

    if (hasLegacyItems) {
      await this.dataSource.query(
        `
          INSERT OR IGNORE INTO receipt_products (
            receipt_name_raw,
            receipt_name_normalized,
            created_at,
            updated_at
          )
          SELECT DISTINCT receipt_product_name, receipt_product_name_normalized, ?, ?
          FROM receipt_items
        `,
        [now, now],
      );
    }

    if (hasLegacyMapping) {
      await this.dataSource.query(
        `
          INSERT OR IGNORE INTO grocy_products (id, name_snapshot, updated_at)
          SELECT DISTINCT grocy_product_id, grocy_product_name_snapshot, ?
          FROM receipt_product_mapping
        `,
        [now],
      );
    }

    if (hasLegacyItems) {
      await this.dataSource.query(
        `
          INSERT OR IGNORE INTO grocy_products (id, name_snapshot, updated_at)
          SELECT DISTINCT grocy_product_id, grocy_product_name_snapshot, ?
          FROM receipt_items
        `,
        [now],
      );
    }

    if (hasLegacyMapping) {
      await this.dataSource.query(
        `
          INSERT OR IGNORE INTO receipt_product_mappings (
            store_id,
            receipt_product_id,
            grocy_product_id,
            confidence,
            usage_count,
            last_used_at,
            created_at,
            updated_at
          )
          SELECT
            s.id,
            rp.id,
            rpm.grocy_product_id,
            rpm.confidence,
            rpm.usage_count,
            rpm.last_used_at,
            rpm.created_at,
            rpm.updated_at
          FROM receipt_product_mapping rpm
          INNER JOIN stores s ON s.store_key = rpm.store_key
          INNER JOIN receipt_products rp ON rp.receipt_name_normalized = rpm.receipt_name_normalized
        `,
      );
    }

    if (hasLegacyReceipts) {
      await this.dataSource.query(
        `
          INSERT OR IGNORE INTO spesa_receipts (
            id,
            store_id,
            purchased_at,
            source,
            file_name,
            subtotal,
            total,
            raw_text,
            fingerprint,
            created_at
          )
          SELECT
            r.id,
            s.id,
            r.purchased_at,
            r.source,
            r.file_name,
            r.subtotal,
            r.total,
            r.raw_text,
            r.fingerprint,
            r.created_at
          FROM receipts r
          INNER JOIN stores s ON s.store_key = r.store_key
        `,
      );
    }

    if (hasPrefixedReceipts) {
      await this.dataSource.query(
        `
          INSERT OR IGNORE INTO spesa_receipts (
            id,
            store_id,
            purchased_at,
            source,
            file_name,
            subtotal,
            total,
            raw_text,
            fingerprint,
            created_at
          )
          SELECT
            id,
            store_id,
            purchased_at,
            source,
            file_name,
            subtotal,
            total,
            raw_text,
            fingerprint,
            created_at
          FROM normalized_receipts
        `,
      );
    }

    if (hasLegacyItems) {
      await this.dataSource.query(
        `
          INSERT OR IGNORE INTO spesa_receipt_items (
            id,
            receipt_id,
            receipt_product_id,
            grocy_product_id,
            quantity,
            unit_price,
            discount_total,
            line_total_discounted,
            vat_rate,
            created_at
          )
          SELECT
            ri.id,
            ri.receipt_id,
            rp.id,
            ri.grocy_product_id,
            ri.quantity,
            ri.unit_price,
            ri.discount_total,
            ri.line_total_discounted,
            ri.vat_rate,
            ri.created_at
          FROM receipt_items ri
          INNER JOIN spesa_receipts nr ON nr.id = ri.receipt_id
          INNER JOIN receipt_products rp ON rp.receipt_name_normalized = ri.receipt_product_name_normalized
        `,
      );
    }

    if (hasPrefixedItems) {
      await this.dataSource.query(
        `
          INSERT OR IGNORE INTO spesa_receipt_items (
            id,
            receipt_id,
            receipt_product_id,
            grocy_product_id,
            quantity,
            unit_price,
            discount_total,
            line_total_discounted,
            vat_rate,
            created_at
          )
          SELECT
            id,
            receipt_id,
            receipt_product_id,
            grocy_product_id,
            quantity,
            unit_price,
            discount_total,
            line_total_discounted,
            vat_rate,
            created_at
          FROM normalized_receipt_items
        `,
      );
    }
  }

  private async dropLegacySpesaTables(): Promise<void> {
    await this.dataSource.query(
      'DROP TABLE IF EXISTS normalized_receipt_items',
    );
    await this.dataSource.query('DROP TABLE IF EXISTS normalized_receipts');
    await this.dataSource.query('DROP TABLE IF EXISTS product_price_history');
    await this.dataSource.query('DROP TABLE IF EXISTS receipt_items');
    await this.dataSource.query('DROP TABLE IF EXISTS receipts');
    await this.dataSource.query('DROP TABLE IF EXISTS receipt_product_mapping');
  }

  private async tableExists(tableName: string): Promise<boolean> {
    const rows = await this.queryRows<{ name: string }>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name = ?
        LIMIT 1
      `,
      [tableName],
    );

    return rows.length > 0;
  }

  private async ensureStoreId(
    storeKey: string,
    storeName: string,
    queryable: Pick<QueryRunner, 'query'> | DataSource = this.dataSource,
  ): Promise<number> {
    // Idempotent upsert so all downstream writes can rely on a stable store FK.
    const now = new Date().toISOString();

    await queryable.query(
      `
        INSERT INTO stores (store_key, store_name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(store_key)
        DO UPDATE SET
          store_name = excluded.store_name,
          updated_at = excluded.updated_at
      `,
      [storeKey, storeName, now, now],
    );

    const rows = (await queryable.query(
      `SELECT id FROM stores WHERE store_key = ? LIMIT 1`,
      [storeKey],
    )) as IdRow[];

    const storeId = Number(rows[0]?.id ?? 0);
    if (!Number.isInteger(storeId) || storeId <= 0) {
      throw new BadRequestException(
        'Impossibile determinare lo store interno.',
      );
    }

    return storeId;
  }

  private async ensureReceiptProductId(
    receiptNameRaw: string,
    receiptNameNormalized: string,
    queryable: Pick<QueryRunner, 'query'> | DataSource = this.dataSource,
  ): Promise<number> {
    // Normalize receipt product identities to a dictionary table reused by mappings/items.
    const now = new Date().toISOString();

    await queryable.query(
      `
        INSERT INTO receipt_products (
          receipt_name_raw,
          receipt_name_normalized,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(receipt_name_normalized)
        DO UPDATE SET
          receipt_name_raw = excluded.receipt_name_raw,
          updated_at = excluded.updated_at
      `,
      [receiptNameRaw, receiptNameNormalized, now, now],
    );

    const rows = (await queryable.query(
      `
        SELECT id
        FROM receipt_products
        WHERE receipt_name_normalized = ?
        LIMIT 1
      `,
      [receiptNameNormalized],
    )) as IdRow[];

    const receiptProductId = Number(rows[0]?.id ?? 0);
    if (!Number.isInteger(receiptProductId) || receiptProductId <= 0) {
      throw new BadRequestException(
        'Impossibile determinare il prodotto scontrino interno.',
      );
    }

    return receiptProductId;
  }

  private async upsertGrocyProductSnapshot(
    grocyProductId: number,
    grocyProductName: string,
    queryable: Pick<QueryRunner, 'query'> | DataSource = this.dataSource,
  ): Promise<void> {
    const now = new Date().toISOString();

    await queryable.query(
      `
        INSERT INTO grocy_products (id, name_snapshot, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(id)
        DO UPDATE SET
          name_snapshot = excluded.name_snapshot,
          updated_at = excluded.updated_at
      `,
      [grocyProductId, grocyProductName, now],
    );
  }

  private async queryRows<T>(sql: string, params: unknown[]): Promise<T[]> {
    const result: unknown = await this.dataSource.query(sql, params);
    if (!Array.isArray(result)) {
      return [];
    }

    return result as T[];
  }

  private normalizeReceiptsPage(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return DEFAULT_RECEIPTS_PAGE;
    }

    const rounded = Math.trunc(value);
    if (rounded <= 0) {
      return DEFAULT_RECEIPTS_PAGE;
    }

    return rounded;
  }

  private normalizeReceiptsPageSize(value: number | undefined): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return DEFAULT_RECEIPTS_PAGE_SIZE;
    }

    const rounded = Math.trunc(value);
    if (rounded <= 0) {
      return DEFAULT_RECEIPTS_PAGE_SIZE;
    }

    return Math.min(rounded, MAX_RECEIPTS_PAGE_SIZE);
  }

  private normalizeReceiptId(value: number): number {
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException('ID scontrino non valido.');
    }

    return value;
  }

  private async ensureSpesaReceiptItemsCascadeDelete(): Promise<void> {
    const fkRows = await this.queryRows<{
      table: string;
      from: string;
      on_delete: string;
    }>(`PRAGMA foreign_key_list('spesa_receipt_items')`, []);

    const receiptForeignKey = fkRows.find(
      (row) => row.table === 'spesa_receipts' && row.from === 'receipt_id',
    );

    if (
      receiptForeignKey &&
      receiptForeignKey.on_delete.toUpperCase() === 'CASCADE'
    ) {
      return;
    }

    this.logger.log(
      'Aggiornamento schema SQLite: ON DELETE CASCADE su spesa_receipt_items.receipt_id',
    );

    await this.dataSource.query('PRAGMA foreign_keys = OFF');
    try {
      await this.dataSource.query(
        'ALTER TABLE spesa_receipt_items RENAME TO spesa_receipt_items__old',
      );

      await this.dataSource.query(`
        CREATE TABLE spesa_receipt_items (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          receipt_id INTEGER NOT NULL,
          receipt_product_id INTEGER NOT NULL,
          grocy_product_id INTEGER NOT NULL,
          quantity REAL NOT NULL,
          unit_price REAL NOT NULL,
          discount_total REAL NOT NULL,
          line_total_discounted REAL NOT NULL,
          vat_rate REAL NOT NULL,
          created_at TEXT NOT NULL,
          FOREIGN KEY (receipt_id) REFERENCES spesa_receipts(id) ON DELETE CASCADE,
          FOREIGN KEY (receipt_product_id) REFERENCES receipt_products(id),
          FOREIGN KEY (grocy_product_id) REFERENCES grocy_products(id)
        )
      `);

      await this.dataSource.query(`
        INSERT INTO spesa_receipt_items (
          id,
          receipt_id,
          receipt_product_id,
          grocy_product_id,
          quantity,
          unit_price,
          discount_total,
          line_total_discounted,
          vat_rate,
          created_at
        )
        SELECT
          id,
          receipt_id,
          receipt_product_id,
          grocy_product_id,
          quantity,
          unit_price,
          discount_total,
          line_total_discounted,
          vat_rate,
          created_at
        FROM spesa_receipt_items__old
      `);

      await this.dataSource.query('DROP TABLE spesa_receipt_items__old');
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_spesa_receipt_items_receipt
        ON spesa_receipt_items(receipt_id)
      `);
      await this.dataSource.query(`
        CREATE INDEX IF NOT EXISTS idx_spesa_receipt_items_product
        ON spesa_receipt_items(grocy_product_id)
      `);
    } finally {
      await this.dataSource.query('PRAGMA foreign_keys = ON');
    }
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

  private normalizeOptionalMoney(
    value: number | null | undefined,
  ): number | null {
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
      return this.roundMoney(
        (sortedValues[middleIndex - 1] + sortedValues[middleIndex]) / 2,
      );
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
    // Fingerprint is used for idempotent imports and duplicate-save prevention.
    const material = [
      input.storeKey,
      input.purchasedAt.slice(0, 16),
      input.total === null ? '' : String(this.roundMoney(input.total)),
      this.normalizeReceiptRawText(input.rawText),
    ].join('|');

    return createHash('sha256').update(material).digest('hex');
  }
}
