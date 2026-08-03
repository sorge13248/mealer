import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { catchError, forkJoin, map, of } from 'rxjs';
import { ApiEndpointsService } from '../../api/api-endpoints';
import { BackButtonComponent } from '../../components/back-button/back-button';
import { ItemCardComponent } from '../../components/item-card/item-card';
import { LoadingSpinnerComponent } from '../../components/loading-spinner/loading-spinner';
import { withHttpCache } from '../../interceptors/http-cache.interceptor';
import {
  Item,
  ItemWithStockSummary,
  ProductStockSummary,
  StockEntry,
  buildStockSummaryByProductId,
  mapItemsWithStockSummary,
} from '../shared/product-shared';
import {
  VIRTUAL_NO_MACROCATEGORY_KEY,
  VIRTUAL_NO_MACROCATEGORY_TITLE
} from './macro-category.constants';
import { ParsedMacroCategoryName, parseMacroCategoryName } from '../shared/macro-category-mapping';

type MacroCategoryViewItem = ItemWithStockSummary;

@Component({
  selector: 'app-macro-category-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LoadingSpinnerComponent, ItemCardComponent],
  templateUrl: './macro-category-page.html',
  styleUrl: './macro-category-page.scss'
})
export class MacroCategoryPage {
  private readonly http = inject(HttpClient);
  private readonly apiEndpoints = inject(ApiEndpointsService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly macroCategory = signal('');
  protected readonly items = signal<Item[]>([]);
  protected readonly stockEntries = signal<StockEntry[]>([]);

  protected readonly parsedCategory = computed<ParsedMacroCategoryName>(() =>
    this.parseMacroCategory(this.macroCategory())
  );

  protected readonly stockSummaryByProductId = computed<Map<number, ProductStockSummary>>(() =>
    buildStockSummaryByProductId(this.stockEntries())
  );

  protected readonly filteredItems = computed<MacroCategoryViewItem[]>(() => {
    const macroCategory = this.macroCategory();
    if (!macroCategory) {
      return [];
    }

    const categoryItems =
      macroCategory === VIRTUAL_NO_MACROCATEGORY_KEY
        ? this.items().filter((item) => !item.userfields?.food_macrocategory?.trim())
        : this.items().filter((item) => item.userfields?.food_macrocategory?.trim() === macroCategory);

    const stockSummaryByProductId = this.stockSummaryByProductId();

    return mapItemsWithStockSummary(categoryItems, stockSummaryByProductId);
  });

  constructor() {
    this.route.paramMap
      .pipe(
        map((params) => params.get('macroCategory') ?? ''),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe((encodedMacroCategory) => {
        const decodedMacroCategory = decodeURIComponent(encodedMacroCategory).trim();
        this.macroCategory.set(decodedMacroCategory);
        this.loadItems();
      });
  }

  protected reloadItems(): void {
    this.loadItems();
  }

  private loadItems(): void {
    if (!this.macroCategory()) {
      this.errorMessage.set('Macrocategoria non valida.');
      this.isLoading.set(false);
      return;
    }

    this.isLoading.set(true);
    this.errorMessage.set(null);

    forkJoin({
      products: this.http.get<Item[]>(this.apiEndpoints.products(), { context: withHttpCache(true) }),
      stock: this.http
        .get<StockEntry[]>(this.apiEndpoints.stock(), { context: withHttpCache(true) })
        .pipe(catchError(() => of([])))
    }).subscribe({
      next: ({ products, stock }) => {
        if (!Array.isArray(products)) {
          this.items.set([]);
          this.stockEntries.set([]);
          this.errorMessage.set('Il formato della risposta API non e valido.');
          this.isLoading.set(false);
          return;
        }

        this.items.set(products);
        this.stockEntries.set(Array.isArray(stock) ? stock : []);
        this.isLoading.set(false);
      },
      error: () => {
        this.items.set([]);
        this.stockEntries.set([]);
        this.errorMessage.set('Impossibile caricare gli alimenti. Riprova.');
        this.isLoading.set(false);
      }
    });
  }

  private parseMacroCategory(macroCategory: string): ParsedMacroCategoryName {
    if (macroCategory === VIRTUAL_NO_MACROCATEGORY_KEY) {
      return {
        title: VIRTUAL_NO_MACROCATEGORY_TITLE,
        subtitle: null
      };
    }

    return parseMacroCategoryName(macroCategory);
  }
}