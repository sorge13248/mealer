import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, forkJoin, map, of } from 'rxjs';
import { API_ENDPOINTS } from '../../api/api-endpoints';
import { LoadingSpinnerComponent } from '../../components/loading-spinner/loading-spinner';
import { withHttpCache } from '../../interceptors/http-cache.interceptor';
import {
    buildStockSummaryByProductId,
    formatBestBeforeDate as formatBestBeforeDateLocal,
    getDaysUntilBestBeforeLabel as getDaysUntilBestBeforeLabelLocal,
    getNormalizedYukaScore as getNormalizedYukaScoreLocal,
    getYukaScoreView as getYukaScoreViewLocal,
    toBestBeforeTime as toBestBeforeTimeLocal
} from '../shared/product-shared';
import {
    VIRTUAL_NO_MACROCATEGORY_KEY,
    VIRTUAL_NO_MACROCATEGORY_TITLE
} from './macro-category.constants';

interface ItemUserFields {
    food_macrocategory?: string | null;
    yuka_score?: number | string | null;
}

interface Item {
    id: number;
    name: string;
    description?: string | null;
    picture_file_name?: string | null;
    userfields?: ItemUserFields | null;
}

interface StockEntry {
    product_id: number | string;
    amount: number | string;
    amount_opened: number | string;
    best_before_date?: string | null;
}

interface ProductStockSummary {
    amount: number;
    amountOpened: number;
    nearestBestBeforeDate: string | null;
}

interface ParsedMacroCategory {
    title: string;
    subtitle: string | null;
}

interface YukaScoreView {
    value: number;
    color: string;
}

@Component({
    selector: 'app-macro-category-page',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [LoadingSpinnerComponent],
    templateUrl: './macro-category-page.html',
    styleUrl: './macro-category-page.scss'
})
export class MacroCategoryPage {
    private readonly http = inject(HttpClient);
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly destroyRef = inject(DestroyRef);
    private readonly localDateFormatter = new Intl.DateTimeFormat(navigator.language, {
        dateStyle: 'medium'
    });

    protected readonly isLoading = signal(true);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly macroCategory = signal('');
    protected readonly items = signal<Item[]>([]);
    protected readonly stockEntries = signal<StockEntry[]>([]);
    protected readonly pictureObjectUrls = signal<Record<string, string>>({});
    protected readonly pictureLoading = signal<Record<string, boolean>>({});
    protected readonly pictureFailed = signal<Record<string, boolean>>({});
    protected readonly previewImageUrl = signal<string | null>(null);
    protected readonly previewImageAlt = signal('');
    protected readonly previewPosition = signal<{ x: number; y: number }>({ x: 0, y: 0 });

    private previewTouchPointerId: number | null = null;
    private touchLongPressTimer: number | null = null;

    protected readonly parsedCategory = computed<ParsedMacroCategory>(() =>
        this.parseMacroCategory(this.macroCategory())
    );

    protected readonly filteredItems = computed<Item[]>(() => {
        const macroCategory = this.macroCategory();
        if (!macroCategory) {
            return [];
        }

        const categoryItems =
            macroCategory === VIRTUAL_NO_MACROCATEGORY_KEY
                ? this.items().filter((item) => !item.userfields?.food_macrocategory?.trim())
                : this.items().filter(
                    (item) => item.userfields?.food_macrocategory?.trim() === macroCategory
                );

        return [...categoryItems].sort((leftItem, rightItem) => {
            const leftStockSummary = this.getStockSummary(leftItem);
            const rightStockSummary = this.getStockSummary(rightItem);

            const leftBestBeforeTime = this.toBestBeforeTime(leftStockSummary.nearestBestBeforeDate);
            const rightBestBeforeTime = this.toBestBeforeTime(rightStockSummary.nearestBestBeforeDate);

            if (leftBestBeforeTime !== rightBestBeforeTime) {
                return leftBestBeforeTime - rightBestBeforeTime;
            }

            const leftScore = this.getNormalizedYukaScore(leftItem);
            const rightScore = this.getNormalizedYukaScore(rightItem);

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
        });
    });

    protected readonly stockSummaryByProductId = computed<Map<number, ProductStockSummary>>(() => {
        return buildStockSummaryByProductId(this.stockEntries());
    });

    constructor() {
        this.destroyRef.onDestroy(() => {
            this.clearTouchLongPressTimer();
            this.clearPictureObjectUrls();
        });

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

    protected goBack(): void {
        this.router.navigate(['/']);
    }

    protected reloadItems(): void {
        this.loadItems();
    }

    protected getProductPictureUrl(fileName: string | null | undefined): string | null {
        const sanitizedFileName = fileName?.trim();
        if (!sanitizedFileName) {
            return null;
        }

        return this.pictureObjectUrls()[sanitizedFileName] ?? null;
    }

    protected hasProductPicture(fileName: string | null | undefined): boolean {
        return Boolean(fileName?.trim());
    }

    protected isProductPictureLoading(fileName: string | null | undefined): boolean {
        const sanitizedFileName = fileName?.trim();
        if (!sanitizedFileName) {
            return false;
        }

        return this.pictureLoading()[sanitizedFileName] ?? false;
    }

    protected didProductPictureFail(fileName: string | null | undefined): boolean {
        const sanitizedFileName = fileName?.trim();
        if (!sanitizedFileName) {
            return false;
        }

        return this.pictureFailed()[sanitizedFileName] ?? false;
    }

    protected getStockSummary(item: Item): ProductStockSummary {
        return (
            this.stockSummaryByProductId().get(item.id) ?? {
                amount: 0,
                amountOpened: 0,
                nearestBestBeforeDate: null
            }
        );
    }

    protected formatBestBeforeDate(bestBeforeDate: string | null): string | null {
        return formatBestBeforeDateLocal(bestBeforeDate, this.localDateFormatter);
    }

    protected getDaysUntilBestBeforeLabel(bestBeforeDate: string | null): string | null {
        return getDaysUntilBestBeforeLabelLocal(bestBeforeDate);
    }

    protected getYukaScoreView(item: Item): YukaScoreView | null {
        return getYukaScoreViewLocal(item);
    }

    protected isPreviewVisible(): boolean {
        return this.previewImageUrl() !== null;
    }

    protected onImagePointerEnter(event: PointerEvent, imageUrl: string, itemName: string): void {
        if (event.pointerType !== 'mouse') {
            return;
        }

        this.showImagePreview(imageUrl, itemName, event.clientX, event.clientY);
    }

    protected onImagePointerMove(event: PointerEvent, imageUrl: string, itemName: string): void {
        if (event.pointerType === 'mouse') {
            this.showImagePreview(imageUrl, itemName, event.clientX, event.clientY);
            return;
        }

        if (event.pointerType === 'touch' && this.previewTouchPointerId === event.pointerId && this.isPreviewVisible()) {
            this.setPreviewPosition(event.clientX, event.clientY);
        }
    }

    protected onImagePointerLeave(event: PointerEvent): void {
        if (event.pointerType !== 'mouse') {
            return;
        }

        this.hideImagePreview();
    }

    protected onImagePointerDown(event: PointerEvent, imageUrl: string, itemName: string): void {
        if (event.pointerType !== 'touch') {
            return;
        }

        this.clearTouchLongPressTimer();
        this.previewTouchPointerId = event.pointerId;
        this.touchLongPressTimer = window.setTimeout(() => {
            this.showImagePreview(imageUrl, itemName, event.clientX, event.clientY);
        }, 320);
    }

    protected onImagePointerUp(event: PointerEvent): void {
        if (event.pointerType !== 'touch') {
            return;
        }

        this.clearTouchLongPressTimer();
        if (this.previewTouchPointerId === event.pointerId) {
            this.previewTouchPointerId = null;
            this.hideImagePreview();
        }
    }

    protected onImagePointerCancel(event: PointerEvent): void {
        if (event.pointerType !== 'touch') {
            return;
        }

        this.clearTouchLongPressTimer();
        if (this.previewTouchPointerId === event.pointerId) {
            this.previewTouchPointerId = null;
            this.hideImagePreview();
        }
    }

    private loadItems(): void {
        if (!this.macroCategory()) {
            this.errorMessage.set('Macrocategoria non valida.');
            this.isLoading.set(false);
            return;
        }

        this.isLoading.set(true);
        this.errorMessage.set(null);
        this.clearPictureObjectUrls();
        this.pictureLoading.set({});
        this.pictureFailed.set({});

        forkJoin({
            products: this.http.get<Item[]>(API_ENDPOINTS.products, { context: withHttpCache(true) }),
            stock: this.http
                .get<StockEntry[]>(API_ENDPOINTS.stock, { context: withHttpCache(true) })
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
                this.preloadProductPictures(products);
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

    private preloadProductPictures(items: Item[]): void {
        const selectedMacroCategory = this.macroCategory();
        const pictureFileNames = new Set(
            items
                .filter((item) => {
                    if (selectedMacroCategory === VIRTUAL_NO_MACROCATEGORY_KEY) {
                        return !item.userfields?.food_macrocategory?.trim();
                    }

                    return item.userfields?.food_macrocategory?.trim() === selectedMacroCategory;
                })
                .map((item) => item.picture_file_name?.trim())
                .filter((fileName): fileName is string => Boolean(fileName))
        );

        const loadingState: Record<string, boolean> = {};
        for (const fileName of pictureFileNames) {
            loadingState[fileName] = true;
        }

        this.pictureLoading.set(loadingState);

        for (const fileName of pictureFileNames) {
            const pictureEndpoint = API_ENDPOINTS.productPictureByBase64(this.encodeFileNameToBase64(fileName));

            this.http
                .get(pictureEndpoint, { responseType: 'blob', context: withHttpCache(true) })
                .pipe(takeUntilDestroyed(this.destroyRef))
                .subscribe({
                    next: (imageBlob) => {
                        const objectUrl = URL.createObjectURL(imageBlob);

                        this.pictureObjectUrls.update((currentObjectUrls) => {
                            const existingObjectUrl = currentObjectUrls[fileName];
                            if (existingObjectUrl) {
                                URL.revokeObjectURL(existingObjectUrl);
                            }

                            return {
                                ...currentObjectUrls,
                                [fileName]: objectUrl
                            };
                        });

                        this.pictureLoading.update((currentLoadingState) => ({
                            ...currentLoadingState,
                            [fileName]: false
                        }));
                    },
                    error: () => {
                        this.pictureLoading.update((currentLoadingState) => ({
                            ...currentLoadingState,
                            [fileName]: false
                        }));
                        this.pictureFailed.update((currentFailedState) => ({
                            ...currentFailedState,
                            [fileName]: true
                        }));
                    }
                });
        }
    }

    private parseMacroCategory(macroCategory: string): ParsedMacroCategory {
        if (macroCategory === VIRTUAL_NO_MACROCATEGORY_KEY) {
            return {
                title: VIRTUAL_NO_MACROCATEGORY_TITLE,
                subtitle: null
            };
        }

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

    private encodeFileNameToBase64(fileName: string): string {
        const utf8Bytes = new TextEncoder().encode(fileName);
        let binaryString = '';

        for (const byte of utf8Bytes) {
            binaryString += String.fromCharCode(byte);
        }

        return btoa(binaryString);
    }

    private clearPictureObjectUrls(): void {
        const currentObjectUrls = this.pictureObjectUrls();
        for (const objectUrl of Object.values(currentObjectUrls)) {
            URL.revokeObjectURL(objectUrl);
        }

        this.pictureObjectUrls.set({});
    }

    private showImagePreview(imageUrl: string, itemName: string, x: number, y: number): void {
        this.previewImageUrl.set(imageUrl);
        this.previewImageAlt.set(`Anteprima di ${itemName}`);
        this.setPreviewPosition(x, y);
    }

    private hideImagePreview(): void {
        this.previewImageUrl.set(null);
        this.previewImageAlt.set('');
    }

    private setPreviewPosition(x: number, y: number): void {
        const popupWidth = 320;
        const popupHeight = 320;
        const offset = 18;
        const maxX = Math.max(offset, window.innerWidth - popupWidth - 8);
        const maxY = Math.max(offset, window.innerHeight - popupHeight - 8);

        this.previewPosition.set({
            x: Math.min(Math.max(offset, x + offset), maxX),
            y: Math.min(Math.max(offset, y + offset), maxY)
        });
    }

    private clearTouchLongPressTimer(): void {
        if (this.touchLongPressTimer !== null) {
            clearTimeout(this.touchLongPressTimer);
            this.touchLongPressTimer = null;
        }
    }

    private getNormalizedYukaScore(item: Item): number | null {
        return getNormalizedYukaScoreLocal(item);
    }

    private toBestBeforeTime(bestBeforeDate: string | null): number {
        return toBestBeforeTimeLocal(bestBeforeDate);
    }
}
