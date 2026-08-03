import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { ApiEndpointsService } from '../../api/api-endpoints';
import { LoadingSpinnerComponent } from '../../components/loading-spinner/loading-spinner';
import { withHttpCache } from '../../interceptors/http-cache.interceptor';
import {
    VIRTUAL_NO_MACROCATEGORY_KEY,
    VIRTUAL_NO_MACROCATEGORY_TITLE
} from '../macro-category/macro-category.constants';
import {
    isExcludedMacroCategory,
    parseMacroCategoryName
} from '../shared/macro-category-mapping';
import { Item } from '../shared/product-shared';

interface VolatileStockProductEntry {
    product_id: number | string;
}

interface VolatileMissingProductEntry {
    id: number | string;
}

interface VolatileStockResponse {
    due_products?: VolatileStockProductEntry[] | null;
    overdue_products?: VolatileStockProductEntry[] | null;
    expired_products?: VolatileStockProductEntry[] | null;
    missing_products?: VolatileMissingProductEntry[] | null;
}

interface MacroCategoryCard {
    key: string;
    title: string;
    subtitle: string | null;
    itemCount: number;
}

@Component({
    selector: 'app-dispensa-page',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [LoadingSpinnerComponent, RouterLink],
    templateUrl: './dispensa-page.html',
    styleUrl: './dispensa-page.scss'
})
export class DispensaPage {
    private readonly http = inject(HttpClient);
    private readonly apiEndpoints = inject(ApiEndpointsService);

    protected readonly isLoading = signal(true);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly items = signal<Item[]>([]);
    protected readonly volatileStock = signal<VolatileStockResponse | null>(null);

    protected readonly categoryCards = computed<MacroCategoryCard[]>(() => {
        const groupedCategories = new Map<string, MacroCategoryCard>();
        let itemsWithoutMacroCategory = 0;

        for (const item of this.items()) {
            const macroCategory = item.userfields?.food_macrocategory?.trim();
            if (!macroCategory) {
                itemsWithoutMacroCategory += 1;
                continue;
            }

            const parsedCategory = parseMacroCategoryName(macroCategory);
            if (isExcludedMacroCategory(macroCategory)) {
                continue;
            }

            const existingCard = groupedCategories.get(macroCategory);
            if (existingCard) {
                groupedCategories.set(macroCategory, {
                    ...existingCard,
                    itemCount: existingCard.itemCount + 1
                });
                continue;
            }

            groupedCategories.set(macroCategory, {
                key: macroCategory,
                title: parsedCategory.title,
                subtitle: parsedCategory.subtitle,
                itemCount: 1
            });
        }

        if (itemsWithoutMacroCategory > 0) {
            groupedCategories.set(VIRTUAL_NO_MACROCATEGORY_KEY, {
                key: VIRTUAL_NO_MACROCATEGORY_KEY,
                title: VIRTUAL_NO_MACROCATEGORY_TITLE,
                subtitle: null,
                itemCount: itemsWithoutMacroCategory
            });
        }

        return [...groupedCategories.values()].sort((leftCategory, rightCategory) => {
            const leftIsVirtual = this.isVirtualNoMacroCategory(leftCategory.key);
            const rightIsVirtual = this.isVirtualNoMacroCategory(rightCategory.key);

            if (leftIsVirtual && !rightIsVirtual) {
                return 1;
            }

            if (!leftIsVirtual && rightIsVirtual) {
                return -1;
            }

            return leftCategory.title.localeCompare(rightCategory.title);
        });
    });

    constructor() {
        this.loadItems();
    }

    protected readonly hasDueProducts = computed(() => (this.volatileStock()?.due_products?.length ?? 0) > 0);
    protected readonly hasExpiredProducts = computed(
        () =>
            (this.volatileStock()?.expired_products?.length ?? 0) > 0 ||
            (this.volatileStock()?.overdue_products?.length ?? 0) > 0
    );
    protected readonly hasMissingProducts = computed(() => (this.volatileStock()?.missing_products?.length ?? 0) > 0);

    protected reloadItems(): void {
        this.loadItems();
    }

    protected isVirtualNoMacroCategory(categoryKey: string): boolean {
        return categoryKey === VIRTUAL_NO_MACROCATEGORY_KEY;
    }

    private loadItems(): void {
        this.isLoading.set(true);
        this.errorMessage.set(null);

        forkJoin({
            products: this.http.get<Item[]>(this.apiEndpoints.products(), { context: withHttpCache(true) }),
            volatile: this.http
                .get<VolatileStockResponse>(this.apiEndpoints.stockVolatile(), { context: withHttpCache(true) })
                .pipe(catchError(() => of([])))
        }).subscribe({
            next: ({ products, volatile }) => {
                if (!Array.isArray(products)) {
                    this.items.set([]);
                    this.volatileStock.set(null);
                    this.errorMessage.set('Il formato della risposta API non è valido.');
                    this.isLoading.set(false);
                    return;
                }

                this.items.set(products);
                this.volatileStock.set(this.isVolatileResponse(volatile) ? volatile : null);
                this.isLoading.set(false);
            },
            error: () => {
                this.items.set([]);
                this.volatileStock.set(null);
                this.errorMessage.set('Impossibile caricare gli alimenti. Riprova.');
                this.isLoading.set(false);
            }
        });
    }

    private isVolatileResponse(value: unknown): value is VolatileStockResponse {
        return Boolean(value) && typeof value === 'object';
    }
}
