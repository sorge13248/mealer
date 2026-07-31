import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { ApiEndpointsService } from '../../api/api-endpoints';
import { LoadingSpinnerComponent } from '../../components/loading-spinner/loading-spinner';
import { withHttpCache } from '../../interceptors/http-cache.interceptor';
import { RuntimeSecretsService } from '../../services/runtime-secrets.service';
import { SecureSecretsStorageService } from '../../services/secure-secrets-storage.service';
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

const ONBOARDING_VERSION_KEY = 'mealer-onboarding-completed-v1';

@Component({
    selector: 'app-home-page',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [LoadingSpinnerComponent],
    templateUrl: './home-page.html',
    styleUrl: './home-page.scss'
})
export class HomePage {
    private readonly http = inject(HttpClient);
    private readonly apiEndpoints = inject(ApiEndpointsService);
    private readonly router = inject(Router);
    private readonly runtimeSecrets = inject(RuntimeSecretsService);
    private readonly secureSecretsStorage = inject(SecureSecretsStorageService);

    protected readonly isLoading = signal(true);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly resetErrorMessage = signal<string | null>(null);
    protected readonly isResettingSecrets = signal(false);
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

    protected openCategory(macroCategory: string): void {
        this.router.navigate(['/macrocategoria', encodeURIComponent(macroCategory)]);
    }

    protected openMealPlanner(): void {
        this.router.navigate(['/pianificatore-pasto']);
    }

    protected openVolatileSection(section: 'due' | 'expired' | 'missing'): void {
        this.router.navigate(['/stock-volatile', section]);
    }

    protected isVirtualNoMacroCategory(categoryKey: string): boolean {
        return categoryKey === VIRTUAL_NO_MACROCATEGORY_KEY;
    }

    protected async resetSecretsFromHome(): Promise<void> {
        this.isResettingSecrets.set(true);
        this.resetErrorMessage.set(null);

        try {
            await this.secureSecretsStorage.clearSecrets();
            this.runtimeSecrets.clearSecrets();
            localStorage.removeItem(ONBOARDING_VERSION_KEY);
            await this.router.navigateByUrl('/', { replaceUrl: true });
            window.location.reload();
        } catch {
            this.resetErrorMessage.set('Impossibile reimpostare i secret. Riprova.');
        } finally {
            this.isResettingSecrets.set(false);
        }
    }

    private loadItems(): void {
        this.isLoading.set(true);
        this.errorMessage.set(null);

        forkJoin({
            products: this.http.get<Item[]>(this.apiEndpoints.products(), { context: withHttpCache(true) }),
            stock: this.http
                .get<unknown[]>(this.apiEndpoints.stock(), { context: withHttpCache(true) })
                .pipe(catchError(() => of([]))),
            volatile: this.http
                .get<VolatileStockResponse>(this.apiEndpoints.stockVolatile(), { context: withHttpCache(true) })
                .pipe(catchError(() => of([])))
        }).subscribe({
            next: ({ products, volatile }) => {
                if (!Array.isArray(products)) {
                    this.items.set([]);
                    this.volatileStock.set(null);
                    this.errorMessage.set('Il formato della risposta API non e valido.');
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
