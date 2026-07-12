import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { API_ENDPOINTS } from '../../api/api-endpoints';
import { LoadingSpinnerComponent } from '../../components/loading-spinner/loading-spinner';
import { withHttpCache } from '../../interceptors/http-cache.interceptor';
import {
    VIRTUAL_NO_MACROCATEGORY_KEY,
    VIRTUAL_NO_MACROCATEGORY_TITLE
} from '../macro-category/macro-category.constants';

interface ItemUserFields {
    food_macrocategory?: string | null;
}

interface Item {
    id: number;
    userfields?: ItemUserFields | null;
}

interface MacroCategoryCard {
    key: string;
    title: string;
    subtitle: string | null;
    itemCount: number;
}

interface ParsedMacroCategory {
    title: string;
    subtitle: string | null;
}

@Component({
    selector: 'app-home-page',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [LoadingSpinnerComponent],
    templateUrl: './home-page.html',
    styleUrl: './home-page.scss'
})
export class HomePage {
    private readonly http = inject(HttpClient);
    private readonly router = inject(Router);

    protected readonly isLoading = signal(true);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly items = signal<Item[]>([]);

    protected readonly categoryCards = computed<MacroCategoryCard[]>(() => {
        const groupedCategories = new Map<string, MacroCategoryCard>();
        let itemsWithoutMacroCategory = 0;

        for (const item of this.items()) {
            const macroCategory = item.userfields?.food_macrocategory?.trim();
            if (!macroCategory) {
                itemsWithoutMacroCategory += 1;
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

            const parsedCategory = this.parseMacroCategory(macroCategory);
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

    protected reloadItems(): void {
        this.loadItems();
    }

    protected openCategory(macroCategory: string): void {
        this.router.navigate(['/macrocategoria', encodeURIComponent(macroCategory)]);
    }

    protected isVirtualNoMacroCategory(categoryKey: string): boolean {
        return categoryKey === VIRTUAL_NO_MACROCATEGORY_KEY;
    }

    private loadItems(): void {
        this.isLoading.set(true);
        this.errorMessage.set(null);

        forkJoin({
            products: this.http.get<Item[]>(API_ENDPOINTS.products, { context: withHttpCache(true) }),
            stock: this.http
                .get<unknown[]>(API_ENDPOINTS.stock, { context: withHttpCache(true) })
                .pipe(catchError(() => of([])))
        }).subscribe({
            next: ({ products }) => {
                if (!Array.isArray(products)) {
                    this.items.set([]);
                    this.errorMessage.set('Il formato della risposta API non e valido.');
                    this.isLoading.set(false);
                    return;
                }

                this.items.set(products);
                this.isLoading.set(false);
            },
            error: () => {
                this.items.set([]);
                this.errorMessage.set('Impossibile caricare gli alimenti. Riprova.');
                this.isLoading.set(false);
            }
        });
    }

    private parseMacroCategory(macroCategory: string): ParsedMacroCategory {
        const macroCategoryWithSubtitleRegex = /^(.*?)\s*\((.+)\)\s*$/;
        const matchedParts = macroCategory.match(macroCategoryWithSubtitleRegex);
        if (!matchedParts) {
            return {
                title: macroCategory,
                subtitle: null
            };
        }

        const [, title, subtitle] = matchedParts;
        return {
            title: title.trim(),
            subtitle: subtitle.trim()
        };
    }
}
