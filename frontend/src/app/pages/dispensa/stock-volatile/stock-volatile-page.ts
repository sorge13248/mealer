import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { ApiEndpointsService } from '../../../api/api-endpoints';
import { BackButtonComponent } from '../../../components/back-button/back-button';
import { ItemCardComponent } from '../../../components/item-card/item-card';
import { LoadingSpinnerComponent } from '../../../components/loading-spinner/loading-spinner';
import { withHttpCache } from '../../../interceptors/http-cache.interceptor';
import { Item, ProductStockSummary, getNormalizedYukaScore, toBestBeforeTime, toNumber } from '../../shared/product-shared';

type VolatileSection = 'due' | 'expired' | 'missing';

interface VolatileStockProduct {
  product_id: number | string;
  amount: number | string;
  amount_opened: number | string;
  best_before_date?: string | null;
  product?: {
    id?: number | string;
    name?: string | null;
    description?: string | null;
    picture_file_name?: string | null;
    userfields?: {
      yuka_score?: number | string | null;
    } | null;
  } | null;
}

interface VolatileMissingProduct {
  id: number | string;
  name: string;
  amount_missing: number | string;
  is_partly_in_stock: number | string;
}

interface VolatileStockResponse {
  due_products?: VolatileStockProduct[] | null;
  overdue_products?: VolatileStockProduct[] | null;
  expired_products?: VolatileStockProduct[] | null;
  missing_products?: VolatileMissingProduct[] | null;
}

interface VolatileViewItem extends Item {
  stockSummary: ProductStockSummary;
  amountMissing: number | null;
}

@Component({
  selector: 'app-stock-volatile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LoadingSpinnerComponent, ItemCardComponent],
  templateUrl: './stock-volatile-page.html',
  styleUrl: './stock-volatile-page.scss'
})
export class StockVolatilePage {
  private readonly http = inject(HttpClient);
  private readonly apiEndpoints = inject(ApiEndpointsService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly section = signal<VolatileSection>('due');
  protected readonly volatileResponse = signal<VolatileStockResponse | null>(null);

  protected readonly sectionTitle = computed(() => {
    switch (this.section()) {
      case 'due':
        return 'Prodotti in scadenza';
      case 'expired':
        return 'Prodotti scaduti';
      case 'missing':
        return 'Prodotti mancanti';
      default:
        return 'Prodotti';
    }
  });

  protected readonly sectionLead = computed(() => {
    switch (this.section()) {
      case 'due':
        return 'Prodotti da consumare a breve';
      case 'expired':
        return 'Prodotti da gestire subito';
      case 'missing':
        return 'Prodotti da riacquistare';
      default:
        return '';
    }
  });

  protected readonly items = computed<VolatileViewItem[]>(() => {
    const response = this.volatileResponse();
    if (!response) {
      return [];
    }

    if (this.section() === 'due') {
      return this.mapStockProducts(response.due_products ?? []).sort((leftItem, rightItem) =>
        this.compareByDateThenYuka(leftItem, rightItem)
      );
    }

    if (this.section() === 'expired') {
      return this
        .mapStockProducts([...(response.overdue_products ?? []), ...(response.expired_products ?? [])])
        .sort((leftItem, rightItem) => this.compareByDateThenYuka(leftItem, rightItem));
    }

    return this.mapMissingProducts(response.missing_products ?? []).sort((leftItem, rightItem) => {
      if ((leftItem.amountMissing ?? 0) !== (rightItem.amountMissing ?? 0)) {
        return (rightItem.amountMissing ?? 0) - (leftItem.amountMissing ?? 0);
      }

      return leftItem.name.localeCompare(rightItem.name);
    });
  });

  constructor() {
    this.route.paramMap
      .pipe(
        map((params) => this.toSection(params.get('section'))),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((section) => {
        this.section.set(section);
        this.loadVolatileStock();
      });
  }

  protected reloadItems(): void {
    this.loadVolatileStock();
  }

  private loadVolatileStock(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.http
      .get<VolatileStockResponse>(this.apiEndpoints.stockVolatile(), { context: withHttpCache(true) })
      .subscribe({
        next: (response) => {
          if (!response || typeof response !== 'object') {
            this.volatileResponse.set(null);
            this.errorMessage.set('Il formato della risposta API non e valido.');
            this.isLoading.set(false);
            return;
          }

          this.volatileResponse.set(response);
          this.isLoading.set(false);
        },
        error: () => {
          this.volatileResponse.set(null);
          this.errorMessage.set('Impossibile caricare i dati di stock volatile. Riprova.');
          this.isLoading.set(false);
        }
      });
  }

  private mapStockProducts(products: VolatileStockProduct[]): VolatileViewItem[] {
    const mappedProducts: VolatileViewItem[] = [];

    for (const entry of products) {
      const productId = toNumber(entry.product?.id ?? entry.product_id);
      if (productId === null) {
        continue;
      }

      mappedProducts.push({
        id: productId,
        name: entry.product?.name?.trim() || 'Prodotto senza nome',
        description: entry.product?.description,
        picture_file_name: entry.product?.picture_file_name,
        userfields: {
          yuka_score: entry.product?.userfields?.yuka_score ?? null
        },
        stockSummary: {
          amount: toNumber(entry.amount) ?? 0,
          amountOpened: toNumber(entry.amount_opened) ?? 0,
          nearestBestBeforeDate: entry.best_before_date?.trim() || null
        },
        amountMissing: null
      });
    }

    return mappedProducts;
  }

  private mapMissingProducts(products: VolatileMissingProduct[]): VolatileViewItem[] {
    const mappedProducts: VolatileViewItem[] = [];

    for (const entry of products) {
      const productId = toNumber(entry.id);
      if (productId === null) {
        continue;
      }

      mappedProducts.push({
        id: productId,
        name: entry.name?.trim() || 'Prodotto senza nome',
        description: null,
        picture_file_name: null,
        userfields: null,
        stockSummary: {
          amount: 0,
          amountOpened: 0,
          nearestBestBeforeDate: null
        },
        amountMissing: Math.max(0, toNumber(entry.amount_missing) ?? 0)
      });
    }

    return mappedProducts;
  }

  private compareByDateThenYuka(leftItem: VolatileViewItem, rightItem: VolatileViewItem): number {
    const leftBestBeforeTime = toBestBeforeTime(leftItem.stockSummary.nearestBestBeforeDate);
    const rightBestBeforeTime = toBestBeforeTime(rightItem.stockSummary.nearestBestBeforeDate);

    if (leftBestBeforeTime !== rightBestBeforeTime) {
      return leftBestBeforeTime - rightBestBeforeTime;
    }

    const leftScore = getNormalizedYukaScore(leftItem);
    const rightScore = getNormalizedYukaScore(rightItem);

    if (leftScore === null && rightScore === null) {
      return leftItem.name.localeCompare(rightItem.name);
    }

    if (leftScore === null) {
      return 1;
    }

    if (rightScore === null) {
      return -1;
    }

    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }

    return leftItem.name.localeCompare(rightItem.name);
  }

  private toSection(rawSection: string | null): VolatileSection {
    if (rawSection === 'expired' || rawSection === 'missing') {
      return rawSection;
    }

    return 'due';
  }
}