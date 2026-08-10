import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiEndpointsService } from '../../../api/api-endpoints';
import { BackButtonComponent } from '../../../components/back-button/back-button';
import { ItemCardComponent } from '../../../components/item-card/item-card';
import {
  ReceiptParsingPreviewComponent,
  type ReceiptParsingPreviewModel,
} from '../../../components/receipt-parsing-preview/receipt-parsing-preview';
import { withHttpCache } from '../../../interceptors/http-cache.interceptor';
import { Item } from '../../shared/product-shared';

interface ShoppingInsightsOverview {
  receiptsCount: number;
  totalSpent: number;
  averageReceiptTotal: number;
}

interface ShoppingInsightsMonthlyTotal {
  month: string;
  totalSpent: number;
}

interface ShoppingInsightsMonthlyReceipt {
  month: string;
  receiptsCount: number;
  averageReceiptTotal: number;
}

interface ShoppingInsightsTopProduct {
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

interface ShoppingInsightsPricePoint {
  observedAt: string;
  receiptId: number;
  unitPrice: number;
  quantity: number;
  lineTotalDiscounted: number;
}

interface ShoppingInsightsProductTrend {
  grocyProductId: number;
  grocyProductName: string;
  points: ShoppingInsightsPricePoint[];
}

interface ShoppingInsightsResponse {
  periodDays: number;
  generatedAt: string;
  overview: ShoppingInsightsOverview;
  monthlyTotals: ShoppingInsightsMonthlyTotal[];
  monthlyReceipts: ShoppingInsightsMonthlyReceipt[];
  topProductsBySpend: ShoppingInsightsTopProduct[];
  selectedProductsTrend: ShoppingInsightsProductTrend[];
}

interface StoredReceiptListItem {
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

interface StoredReceiptListResponse {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  items: StoredReceiptListItem[];
}

interface StoredReceiptDetailItem {
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

interface StoredReceiptDetailResponse {
  receipt: StoredReceiptListItem;
  items: StoredReceiptDetailItem[];
}

interface DeleteStoredReceiptResponse {
  receiptId: number;
  deletedReceipt: boolean;
  deletedItemsCount: number;
}

interface ChartPoint {
  x: number;
  y: number;
}

type GrocySearchProduct = Item;

@Component({
  selector: 'app-spesa-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, RouterLink, ItemCardComponent, ReceiptParsingPreviewComponent],
  templateUrl: './spesa-dashboard-page.html',
  styleUrl: './spesa-dashboard-page.scss',
  host: {
    '(document:keydown.escape)': 'onEscapePressed()',
  },
})
export class SpesaDashboardPage {
  private readonly http = inject(HttpClient);
  private readonly apiEndpoints = inject(ApiEndpointsService);

  protected readonly isLoadingInsights = signal(false);
  protected readonly insightsErrorMessage = signal<string | null>(null);
  protected readonly insights = signal<ShoppingInsightsResponse | null>(null);

  protected readonly allGrocyProducts = signal<GrocySearchProduct[]>([]);
  protected readonly isLoadingProducts = signal(false);
  protected readonly productsErrorMessage = signal<string | null>(null);

  protected readonly periodOptions = [7, 14, 30, 90, 180, 365] as const;
  protected readonly selectedPeriodDays = signal<number>(30);

  protected readonly selectedProductIds = signal<Set<number>>(new Set());
  protected readonly isProductFilterModalOpen = signal(false);
  protected readonly modalSearchQuery = signal('');
  protected readonly modalSelectedProductIds = signal<Set<number>>(new Set());

  protected readonly receiptsPageSize = 10;
  protected readonly receiptsPage = signal(1);
  protected readonly receiptsTotalItems = signal(0);
  protected readonly receiptsTotalPages = signal(1);
  protected readonly storedReceipts = signal<StoredReceiptListItem[]>([]);
  protected readonly isLoadingStoredReceipts = signal(false);
  protected readonly storedReceiptsErrorMessage = signal<string | null>(null);
  protected readonly receiptActionMessage = signal<string | null>(null);
  protected readonly deletingReceiptId = signal<number | null>(null);

  protected readonly activeReceiptDetail = signal<StoredReceiptDetailResponse | null>(null);
  protected readonly activeReceiptSummary = signal<StoredReceiptListItem | null>(null);
  protected readonly isLoadingReceiptDetail = signal(false);
  protected readonly receiptDetailErrorMessage = signal<string | null>(null);

  protected readonly selectedProducts = computed(() => {
    const selectedIds = this.selectedProductIds();
    const selectedItems = this.allGrocyProducts().filter((product) => selectedIds.has(product.id));

    return selectedItems.sort((left, right) => left.name.localeCompare(right.name, 'it'));
  });

  protected readonly filteredModalProducts = computed(() => {
    const query = this.normalizeSearchValue(this.modalSearchQuery());
    const products = this.allGrocyProducts();

    if (!query) {
      return products.slice(0, 30);
    }

    const queryTokens = query.split(' ').filter(Boolean);
    return products
      .map((product) => {
        const normalizedName = this.normalizeSearchValue(product.name);
        const startsWithScore = normalizedName.startsWith(query) ? 3 : 0;
        const includesScore = normalizedName.includes(query) ? 2 : 0;
        const tokenScore = queryTokens.filter((token) => normalizedName.includes(token)).length;

        return {
          product,
          score: startsWithScore + includesScore + tokenScore,
        };
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => {
        if (left.score !== right.score) {
          return right.score - left.score;
        }

        return left.product.name.localeCompare(right.product.name, 'it');
      })
      .slice(0, 60)
      .map((entry) => entry.product);
  });

  protected readonly spendChartPoints = computed(() => {
    const monthlyTotals = this.insights()?.monthlyTotals ?? [];
    return this.toLineChartPoints(monthlyTotals.map((entry) => entry.totalSpent));
  });

  protected readonly maxTopProductSpent = computed(() => {
    const topProducts = this.insights()?.topProductsBySpend ?? [];
    return topProducts.reduce((maxValue, product) => Math.max(maxValue, product.totalSpent), 0);
  });

  constructor() {
    this.loadInsights();
    this.loadProducts();
    this.loadStoredReceipts(1);
  }

  protected onEscapePressed(): void {
    this.closeProductFilterModal();
    this.closeReceiptDetailModal();
  }

  protected onPeriodChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const value = Number(target.value);
    if (!Number.isInteger(value) || value <= 0) {
      return;
    }

    this.selectedPeriodDays.set(value);
    this.loadInsights();
  }

  protected openProductFilterModal(): void {
    this.modalSearchQuery.set('');
    this.modalSelectedProductIds.set(new Set(this.selectedProductIds()));
    this.isProductFilterModalOpen.set(true);
  }

  protected closeProductFilterModal(): void {
    if (!this.isProductFilterModalOpen()) {
      return;
    }

    this.isProductFilterModalOpen.set(false);
    this.modalSearchQuery.set('');
  }

  protected onModalSearchQueryChange(value: string): void {
    this.modalSearchQuery.set(value);
  }

  protected isModalProductSelected(productId: number): boolean {
    return this.modalSelectedProductIds().has(productId);
  }

  protected toggleModalProduct(productId: number): void {
    this.modalSelectedProductIds.update((selectedIds) => {
      const next = new Set(selectedIds);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }

      return next;
    });
  }

  protected onModalProductCardClick(productId: number, event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest('a, button, input, select, textarea')) {
      return;
    }

    this.toggleModalProduct(productId);
  }

  protected onModalProductCardKeydown(productId: number, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    this.toggleModalProduct(productId);
  }

  protected applyProductFilter(): void {
    this.selectedProductIds.set(new Set(this.modalSelectedProductIds()));
    this.closeProductFilterModal();
    this.loadInsights();
  }

  protected clearProductFilter(): void {
    this.selectedProductIds.set(new Set());
    this.loadInsights();
  }

  protected goToPreviousReceiptsPage(): void {
    const currentPage = this.receiptsPage();
    if (currentPage <= 1 || this.isLoadingStoredReceipts()) {
      return;
    }

    this.loadStoredReceipts(currentPage - 1);
  }

  protected goToNextReceiptsPage(): void {
    const currentPage = this.receiptsPage();
    if (currentPage >= this.receiptsTotalPages() || this.isLoadingStoredReceipts()) {
      return;
    }

    this.loadStoredReceipts(currentPage + 1);
  }

  protected refreshStoredReceipts(): void {
    this.loadStoredReceipts(this.receiptsPage());
  }

  protected openReceiptDetail(receipt: StoredReceiptListItem): void {
    this.activeReceiptSummary.set(receipt);
    this.activeReceiptDetail.set(null);
    this.receiptDetailErrorMessage.set(null);
    this.isLoadingReceiptDetail.set(true);

    this.http
      .get<StoredReceiptDetailResponse>(this.apiEndpoints.spesaReceiptDetail(receipt.id))
      .subscribe({
        next: (response) => {
          this.activeReceiptDetail.set(response);
          this.isLoadingReceiptDetail.set(false);
        },
        error: () => {
          this.activeReceiptDetail.set(null);
          this.isLoadingReceiptDetail.set(false);
          this.receiptDetailErrorMessage.set('Impossibile caricare il dettaglio scontrino.');
        },
      });
  }

  protected closeReceiptDetailModal(): void {
    this.activeReceiptSummary.set(null);
    this.activeReceiptDetail.set(null);
    this.receiptDetailErrorMessage.set(null);
    this.isLoadingReceiptDetail.set(false);
  }

  protected deleteReceipt(receipt: StoredReceiptListItem): void {
    if (this.deletingReceiptId() !== null) {
      return;
    }

    if (typeof window !== 'undefined') {
      const confirmDelete = window.confirm(
        `Eliminare lo scontrino #${receipt.id} e tutte le sue righe prezzi?`,
      );
      if (!confirmDelete) {
        return;
      }
    }

    this.deletingReceiptId.set(receipt.id);
    this.receiptActionMessage.set(null);

    this.http
      .delete<DeleteStoredReceiptResponse>(this.apiEndpoints.spesaDeleteReceipt(receipt.id))
      .subscribe({
        next: (response) => {
          this.deletingReceiptId.set(null);
          this.receiptActionMessage.set(
            `Scontrino #${response.receiptId} eliminato. Righe collegate eliminate: ${response.deletedItemsCount}.`,
          );

          if (this.activeReceiptSummary()?.id === receipt.id) {
            this.closeReceiptDetailModal();
          }

          const currentPage = this.receiptsPage();
          const currentItems = this.storedReceipts().length;
          const nextPage = currentItems === 1 && currentPage > 1 ? currentPage - 1 : currentPage;

          this.loadStoredReceipts(nextPage);
          this.loadInsights();
        },
        error: () => {
          this.deletingReceiptId.set(null);
          this.receiptActionMessage.set('Eliminazione scontrino non riuscita. Riprova.');
        },
      });
  }

  protected isDeletingReceipt(receiptId: number): boolean {
    return this.deletingReceiptId() === receiptId;
  }

  protected toReceiptOrdinal(indexInPage: number): number {
    return (this.receiptsPage() - 1) * this.receiptsPageSize + indexInPage + 1;
  }

  protected toStoredReceiptPreview(
    detail: StoredReceiptDetailResponse,
  ): ReceiptParsingPreviewModel {
    return {
      source: detail.receipt.source,
      subtotal: detail.receipt.subtotal,
      total: detail.receipt.total,
      items: detail.items.map((item) => ({
        name: item.receiptName,
        rawName: item.receiptName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        discountTotal: item.discountTotal,
        lineTotalDiscounted: item.lineTotalDiscounted,
      })),
    };
  }

  protected getTopProductWidth(totalSpent: number): string {
    const maxValue = this.maxTopProductSpent();
    if (maxValue <= 0) {
      return '0%';
    }

    const percentage = Math.max(0, Math.min(100, Math.round((totalSpent / maxValue) * 100)));
    return `${percentage}%`;
  }

  protected getTrendSparklinePoints(points: ShoppingInsightsPricePoint[]): string {
    return this.toLineChartPoints(points.map((point) => point.unitPrice));
  }

  protected getLastTrendPrice(points: ShoppingInsightsPricePoint[]): number | null {
    if (points.length === 0) {
      return null;
    }

    return points[points.length - 1].unitPrice;
  }

  protected formatMoney(value: number | null): string {
    if (value === null) {
      return '-';
    }

    return new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  protected formatMonth(value: string): string {
    const [yearRaw, monthRaw] = value.split('-');
    const year = Number(yearRaw);
    const month = Number(monthRaw);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
      return value;
    }

    return new Intl.DateTimeFormat('it-IT', {
      month: 'short',
      year: '2-digit',
    }).format(new Date(Date.UTC(year, month - 1, 1)));
  }

  protected formatDate(value: string): string {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat('it-IT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(parsed);
  }

  protected getGrocyProductUrl(productId: number): string {
    return this.apiEndpoints.productPage(productId);
  }

  private loadInsights(): void {
    this.isLoadingInsights.set(true);
    this.insightsErrorMessage.set(null);

    const selectedIds = [...this.selectedProductIds()];
    const endpoint = this.apiEndpoints.spesaInsights(this.selectedPeriodDays(), selectedIds);

    this.http.get<ShoppingInsightsResponse>(endpoint).subscribe({
      next: (response) => {
        this.insights.set(response);
        this.isLoadingInsights.set(false);
      },
      error: () => {
        this.insights.set(null);
        this.insightsErrorMessage.set('Impossibile caricare i dati della spesa. Riprova tra poco.');
        this.isLoadingInsights.set(false);
      },
    });
  }

  private loadStoredReceipts(requestedPage: number): void {
    this.isLoadingStoredReceipts.set(true);
    this.storedReceiptsErrorMessage.set(null);

    this.http
      .get<StoredReceiptListResponse>(
        this.apiEndpoints.spesaReceipts(requestedPage, this.receiptsPageSize),
      )
      .subscribe({
        next: (response) => {
          if (response.items.length === 0 && response.totalItems > 0 && requestedPage > response.totalPages) {
            this.loadStoredReceipts(response.totalPages);
            return;
          }

          this.receiptsPage.set(response.page);
          this.receiptsTotalItems.set(response.totalItems);
          this.receiptsTotalPages.set(Math.max(1, response.totalPages));
          this.storedReceipts.set(response.items);
          this.isLoadingStoredReceipts.set(false);
        },
        error: () => {
          this.storedReceipts.set([]);
          this.isLoadingStoredReceipts.set(false);
          this.storedReceiptsErrorMessage.set('Impossibile caricare gli scontrini salvati.');
        },
      });
  }

  private loadProducts(): void {
    this.isLoadingProducts.set(true);
    this.productsErrorMessage.set(null);

    this.http
      .get<unknown[]>(this.apiEndpoints.products(), { context: withHttpCache(true) })
      .subscribe({
        next: (response) => {
          this.allGrocyProducts.set(this.parseGrocyProducts(response));
          this.isLoadingProducts.set(false);
        },
        error: () => {
          this.allGrocyProducts.set([]);
          this.productsErrorMessage.set('Impossibile caricare i prodotti per il filtro manuale.');
          this.isLoadingProducts.set(false);
        },
      });
  }

  private parseGrocyProducts(payload: unknown[]): GrocySearchProduct[] {
    if (!Array.isArray(payload)) {
      return [];
    }

    const products: GrocySearchProduct[] = [];

    for (const entry of payload) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const record = entry as Record<string, unknown>;
      const id = Number(record['id']);
      const name = typeof record['name'] === 'string' ? record['name'].trim() : '';

      if (!Number.isInteger(id) || !name) {
        continue;
      }

      products.push({
        id,
        name,
        description: typeof record['description'] === 'string' ? record['description'] : null,
        picture_file_name:
          typeof record['picture_file_name'] === 'string' ? record['picture_file_name'] : null,
        userfields:
          record['userfields'] && typeof record['userfields'] === 'object'
            ? (record['userfields'] as Item['userfields'])
            : null,
      });
    }

    return products.sort((left, right) => left.name.localeCompare(right.name, 'it'));
  }

  private normalizeSearchValue(value: string): string {
    return value.toUpperCase().replace(/\s+/g, ' ').trim();
  }

  private toLineChartPoints(values: number[]): string {
    if (values.length === 0) {
      return '';
    }

    if (values.length === 1) {
      return '2,30 98,30';
    }

    const width = 100;
    const height = 32;
    const padding = 2;
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const valueRange = Math.max(1, maxValue - minValue);

    const points: ChartPoint[] = values.map((value, index) => {
      const x = padding + (index * (width - padding * 2)) / (values.length - 1);
      const normalizedY = (value - minValue) / valueRange;
      const y = height - padding - normalizedY * (height - padding * 2);

      return {
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
      };
    });

    return points.map((point) => `${point.x},${point.y}`).join(' ');
  }
}
