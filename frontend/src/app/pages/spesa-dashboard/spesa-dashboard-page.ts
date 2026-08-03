import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiEndpointsService } from '../../api/api-endpoints';
import { BackButtonComponent } from '../../components/back-button/back-button';
import { ItemCardComponent } from '../../components/item-card/item-card';
import { withHttpCache } from '../../interceptors/http-cache.interceptor';
import { Item } from '../shared/product-shared';

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

interface ChartPoint {
  x: number;
  y: number;
}

type GrocySearchProduct = Item;

@Component({
  selector: 'app-spesa-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, RouterLink, ItemCardComponent],
  templateUrl: './spesa-dashboard-page.html',
  styleUrl: './spesa-dashboard-page.scss',
  host: {
    '(document:keydown.escape)': 'closeProductFilterModal()',
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

  protected readonly periodOptions = [30, 90, 180, 365] as const;
  protected readonly selectedPeriodDays = signal<number>(180);

  protected readonly selectedProductIds = signal<Set<number>>(new Set());
  protected readonly isProductFilterModalOpen = signal(false);
  protected readonly modalSearchQuery = signal('');
  protected readonly modalSelectedProductIds = signal<Set<number>>(new Set());

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
