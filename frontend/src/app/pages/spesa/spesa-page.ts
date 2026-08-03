import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { LucideCheck, LucideDynamicIcon, LucideSearch } from '@lucide/angular';
import { ApiEndpointsService } from '../../api/api-endpoints';
import { BackButtonComponent } from '../../components/back-button/back-button';
import { ItemCardComponent } from '../../components/item-card/item-card';
import { withHttpCache } from '../../interceptors/http-cache.interceptor';
import { Item } from '../shared/product-shared';

interface ParsedReceiptItem {
    name: string;
    rawName: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    vatRate: number;
    discountTotal: number;
}

interface ParsedReceiptResponse {
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

interface MatchCandidate {
    productId: number;
    productName: string;
    score: number;
}

interface MatchCandidatesResponseItem {
    receiptName: string;
    receiptNameNormalized: string;
    selectedProductId: number | null;
    selectedProductName: string | null;
    selectedScore: number | null;
    autoAccepted: boolean;
    mappedFromHistory: boolean;
    candidates: MatchCandidate[];
}

interface MatchCandidatesResponse {
    storeName: string;
    storeKey: string;
    highConfidenceThreshold: number;
    grocyProductsPageUrl: string;
    results: MatchCandidatesResponseItem[];
}

interface SaveReceiptResponse {
    receiptId: number;
    savedItemsCount: number;
    savedPricePointsCount: number;
    duplicatedImport: boolean;
}

interface MatchRow extends MatchCandidatesResponseItem {
    rowId: number;
}

type GrocySearchProduct = Item;

@Component({
    selector: 'app-spesa-page',
    changeDetection: ChangeDetectionStrategy.OnPush,
    imports: [BackButtonComponent, LucideDynamicIcon, ItemCardComponent],
    templateUrl: './spesa-page.html',
    styleUrl: './spesa-page.scss',
    host: {
        '(document:keydown.escape)': 'closeManualMatchModal()',
    },
})
export class SpesaPage {
    private readonly http = inject(HttpClient);
    private readonly apiEndpoints = inject(ApiEndpointsService);
    private mappingsSaveFeedbackTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private receiptSaveFeedbackTimeoutId: ReturnType<typeof setTimeout> | null = null;

    protected readonly isParsing = signal(false);
    protected readonly isMatching = signal(false);
    protected readonly isSavingMappings = signal(false);
    protected readonly isSavingReceipt = signal(false);
    protected readonly isMappingsSaved = signal(false);
    protected readonly isReceiptSaved = signal(false);
    protected readonly isDragOverReceiptZone = signal(false);
    protected readonly errorMessage = signal<string | null>(null);
    protected readonly duplicateReceiptWarningMessage = signal<string | null>(null);
    protected readonly matchErrorMessage = signal<string | null>(null);
    protected readonly saveMappingsMessage = signal<string | null>(null);
    protected readonly saveReceiptMessage = signal<string | null>(null);
    protected readonly selectedFileName = signal<string | null>(null);
    protected readonly parsedReceipt = signal<ParsedReceiptResponse | null>(null);
    protected readonly matchRows = signal<MatchRow[]>([]);
    protected readonly storeName = signal<string | null>(null);
    protected readonly highConfidenceThreshold = signal<number | null>(null);
    protected readonly grocyProductsPageUrl = signal<string | null>(null);
    protected readonly allGrocyProducts = signal<GrocySearchProduct[]>([]);
    protected readonly isLoadingManualSearchProducts = signal(false);
    protected readonly manualSearchErrorMessage = signal<string | null>(null);
    protected readonly activeManualMatchRowId = signal<number | null>(null);
    protected readonly manualMatchQuery = signal('');
    protected readonly checkIcon = LucideCheck;
    protected readonly searchIcon = LucideSearch;
    protected readonly activeManualMatchRow = computed(() => {
        const activeRowId = this.activeManualMatchRowId();
        if (activeRowId === null) {
            return null;
        }

        return this.matchRows().find((row) => row.rowId === activeRowId) ?? null;
    });
    protected readonly filteredManualSearchProducts = computed(() => {
        const query = this.normalizeSearchValue(this.manualMatchQuery());
        const products = this.allGrocyProducts();

        if (!query) {
            return products.slice(0, 30);
        }

        const queryTokens = query.split(' ').filter(Boolean);
        return products
            .map((product) => {
                const normalizedProductName = this.normalizeSearchValue(product.name);
                const startsWithScore = normalizedProductName.startsWith(query) ? 2 : 0;
                const includesScore = normalizedProductName.includes(query) ? 1 : 0;
                const tokenScore = queryTokens.filter((token) => normalizedProductName.includes(token)).length;

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
            .slice(0, 30)
            .map((entry) => entry.product);
    });

    protected onReceiptFileSelected(event: Event): void {
        const input = event.target as HTMLInputElement | null;
        const file = input?.files?.item(0);

        if (!file) {
            return;
        }

        this.processReceiptFile(file, input);
    }

    protected onReceiptDragEnter(event: DragEvent): void {
        event.preventDefault();
        this.isDragOverReceiptZone.set(true);
    }

    protected onReceiptDragOver(event: DragEvent): void {
        event.preventDefault();
        this.isDragOverReceiptZone.set(true);
    }

    protected onReceiptDragLeave(event: DragEvent): void {
        const currentTarget = event.currentTarget;
        const relatedTarget = event.relatedTarget;

        if (
            currentTarget instanceof Node &&
            relatedTarget instanceof Node &&
            currentTarget.contains(relatedTarget)
        ) {
            return;
        }

        this.isDragOverReceiptZone.set(false);
    }

    protected onReceiptDrop(event: DragEvent): void {
        event.preventDefault();
        this.isDragOverReceiptZone.set(false);

        const file = event.dataTransfer?.files?.item(0);
        if (!file) {
            return;
        }

        this.processReceiptFile(file);
    }

    private processReceiptFile(file: File, input?: HTMLInputElement | null): void {
        this.isDragOverReceiptZone.set(false);

        const lowerCaseName = file.name.toLowerCase();
        const isPdf = file.type === 'application/pdf' || lowerCaseName.endsWith('.pdf');
        const isImage = file.type.startsWith('image/');

        if (!isPdf && !isImage) {
            this.errorMessage.set('Formato non supportato. Carica un PDF o una foto dello scontrino.');
            this.parsedReceipt.set(null);
            this.selectedFileName.set(null);
            if (input) {
                input.value = '';
            }
            return;
        }

        this.errorMessage.set(null);
        this.duplicateReceiptWarningMessage.set(null);
        this.matchErrorMessage.set(null);
        this.saveMappingsMessage.set(null);
        this.saveReceiptMessage.set(null);
        this.isMappingsSaved.set(false);
        this.isReceiptSaved.set(false);
        this.parsedReceipt.set(null);
        this.matchRows.set([]);
        this.storeName.set(null);
        this.highConfidenceThreshold.set(null);
        this.grocyProductsPageUrl.set(null);
        this.closeManualMatchModal();
        this.selectedFileName.set(file.name);
        this.isParsing.set(true);

        const formData = new FormData();
        formData.append('receipt', file, file.name);

        this.http.post<ParsedReceiptResponse>(this.apiEndpoints.spesaReceiptParse(), formData).subscribe({
            next: (response) => {
                if (response.alreadyImported) {
                    const receiptIdPart =
                        Number.isInteger(response.existingReceiptId) && response.existingReceiptId !== null
                            ? ` (ID ${response.existingReceiptId})`
                            : '';
                    this.duplicateReceiptWarningMessage.set(
                        `Attenzione: questo scontrino risulta gia processato${receiptIdPart}. Se salvi di nuovo, i prezzi non verranno duplicati.`,
                    );
                } else {
                    this.duplicateReceiptWarningMessage.set(null);
                }

                this.parsedReceipt.set(response);
                this.isParsing.set(false);
                this.loadMatchCandidates(response);
            },
            error: () => {
                this.errorMessage.set('Analisi scontrino non riuscita. Verifica il file e riprova.');
                this.duplicateReceiptWarningMessage.set(null);
                this.isParsing.set(false);
            },
        });
    }

    protected refreshMatchCandidates(): void {
        const parsed = this.parsedReceipt();
        if (!parsed) {
            return;
        }

        this.loadMatchCandidates(parsed);
    }

    protected onMatchSelectionChange(rowId: number, productIdRaw: string): void {
        const productId = Number(productIdRaw);
        const updatedRows = this.matchRows().map((row) => {
            if (row.rowId !== rowId) {
                return row;
            }

            if (!Number.isInteger(productId) || productId <= 0) {
                return {
                    ...row,
                    selectedProductId: null,
                    selectedProductName: null,
                    selectedScore: null,
                    autoAccepted: false,
                };
            }

            const candidate = row.candidates.find((entry) => entry.productId === productId);
            return {
                ...row,
                selectedProductId: productId,
                selectedProductName: candidate?.productName ?? row.selectedProductName,
                selectedScore: candidate?.score ?? row.selectedScore,
                autoAccepted: false,
                mappedFromHistory: false,
            };
        });

        this.matchRows.set(updatedRows);
        this.saveMappingsMessage.set(null);
        this.saveReceiptMessage.set(null);
        this.isMappingsSaved.set(false);
        this.isReceiptSaved.set(false);
    }

    protected saveMappings(): void {
        const parsed = this.parsedReceipt();
        if (!parsed) {
            return;
        }

        if (this.isSavingMappings() || this.isSavingReceipt()) {
            return;
        }

        const mappings = this.matchRows()
            .filter((row) => Number.isInteger(row.selectedProductId) && Boolean(row.selectedProductName))
            .map((row) => ({
                receiptName: row.receiptName,
                grocyProductId: row.selectedProductId as number,
                grocyProductName: row.selectedProductName as string,
                confidence: row.selectedScore ?? 1,
            }));

        if (mappings.length === 0) {
            this.saveMappingsMessage.set('Nessun abbinamento selezionato da salvare.');
            return;
        }

        this.isSavingMappings.set(true);
        this.saveMappingsMessage.set(null);

        this.http
            .post<{ savedCount: number }>(this.apiEndpoints.spesaMappings(), {
                storeName: parsed.storeName,
                mappings,
            })
            .subscribe({
                next: (response) => {
                    this.isSavingMappings.set(false);
                    this.triggerMappingsSavedFeedback();
                    this.saveMappingsMessage.set(
                        `Abbinamenti salvati: ${response.savedCount}. Se hai creato nuovi prodotti su Grocy, premi "Ricarica suggerimenti".`,
                    );
                },
                error: () => {
                    this.isSavingMappings.set(false);
                    this.saveMappingsMessage.set('Salvataggio abbinamenti non riuscito. Riprova.');
                },
            });
    }

    protected saveReceiptAndPrices(): void {
        const parsed = this.parsedReceipt();
        if (!parsed) {
            return;
        }

        if (this.isSavingMappings() || this.isSavingReceipt()) {
            return;
        }

        const mappings = this.matchRows()
            .filter((row) => Number.isInteger(row.selectedProductId) && Boolean(row.selectedProductName))
            .map((row) => ({
                receiptName: row.receiptName,
                grocyProductId: row.selectedProductId as number,
                grocyProductName: row.selectedProductName as string,
                confidence: row.selectedScore ?? 1,
            }));

        if (mappings.length === 0) {
            this.saveReceiptMessage.set('Nessuna riga abbinata da salvare.');
            return;
        }

        const selectedProductsByName = new Map<string, { id: number; name: string }>();
        for (const row of this.matchRows()) {
            if (!row.selectedProductId || !row.selectedProductName) {
                continue;
            }

            selectedProductsByName.set(
                this.normalizeForMatching(row.receiptName),
                { id: row.selectedProductId, name: row.selectedProductName },
            );
        }

        const matchedItems = parsed.items
            .map((item) => {
                const matchedProduct = selectedProductsByName.get(
                    this.normalizeForMatching(item.name),
                );

                if (!matchedProduct) {
                    return null;
                }

                return {
                    receiptName: item.name,
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    discountTotal: item.discountTotal,
                    lineTotalDiscounted: Math.max(0, item.totalPrice - item.discountTotal),
                    vatRate: item.vatRate,
                    grocyProductId: matchedProduct.id,
                    grocyProductName: matchedProduct.name,
                };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

        if (matchedItems.length === 0) {
            this.saveReceiptMessage.set('Nessuna riga abbinata da salvare.');
            return;
        }

        this.isSavingReceipt.set(true);
        this.isSavingMappings.set(true);
        this.saveMappingsMessage.set(null);
        this.saveReceiptMessage.set(null);

        this.http
            .post<{ savedCount: number }>(this.apiEndpoints.spesaMappings(), {
                storeName: parsed.storeName,
                mappings,
            })
            .subscribe({
                next: (mappingResponse) => {
                    this.triggerMappingsSavedFeedback();
                    this.saveMappingsMessage.set(
                        `Abbinamenti salvati automaticamente: ${mappingResponse.savedCount}.`,
                    );

                    this.http
                        .post<SaveReceiptResponse>(this.apiEndpoints.spesaReceiptSave(), {
                            storeName: parsed.storeName,
                            source: parsed.source,
                            fileName: parsed.fileName,
                            subtotal: parsed.subtotal,
                            total: parsed.total,
                            rawText: parsed.rawText,
                            items: matchedItems,
                        })
                        .subscribe({
                            next: (response) => {
                                this.isSavingMappings.set(false);
                                this.isSavingReceipt.set(false);

                                if (response.duplicatedImport) {
                                    this.isReceiptSaved.set(false);
                                    this.saveReceiptMessage.set(
                                        `Scontrino gia presente (ID ${response.receiptId}). Nessun nuovo prezzo salvato.`,
                                    );
                                    return;
                                }

                                this.triggerReceiptSavedFeedback();
                                this.saveReceiptMessage.set(
                                    `Scontrino salvato (ID ${response.receiptId}). Righe: ${response.savedItemsCount}, prezzi: ${response.savedPricePointsCount}.`,
                                );
                            },
                            error: () => {
                                this.isSavingMappings.set(false);
                                this.isSavingReceipt.set(false);
                                this.saveReceiptMessage.set('Salvataggio scontrino non riuscito. Riprova.');
                            },
                        });
                },
                error: () => {
                    this.isSavingMappings.set(false);
                    this.isSavingReceipt.set(false);
                    this.saveReceiptMessage.set('Salvataggio abbinamenti non riuscito. Riprova.');
                },
            });
    }

    protected formatScore(value: number | null): string {
        if (value === null) {
            return '-';
        }

        return `${Math.round(value * 100)}%`;
    }

    protected hasSelectedProduct(row: MatchRow): boolean {
        return Number.isInteger(row.selectedProductId) && Boolean(row.selectedProductName);
    }

    protected hasAnySelectedMapping(): boolean {
        return this.matchRows().some(
            (row) => Number.isInteger(row.selectedProductId) && Boolean(row.selectedProductName),
        );
    }

    protected getBestCandidate(row: MatchRow): MatchCandidate | null {
        return row.candidates[0] ?? null;
    }

    protected applyBestCandidate(row: MatchRow): void {
        const bestCandidate = this.getBestCandidate(row);
        if (!bestCandidate) {
            return;
        }

        this.onMatchSelectionChange(row.rowId, String(bestCandidate.productId));
    }

    protected hasSelectedProductOutsideCandidates(row: MatchRow): boolean {
        if (!this.hasSelectedProduct(row) || !row.selectedProductId) {
            return false;
        }

        return !row.candidates.some((candidate) => candidate.productId === row.selectedProductId);
    }

    protected toSelectionValue(row: MatchRow): string {
        return row.selectedProductId ? String(row.selectedProductId) : '';
    }

    protected openManualMatchModal(row: MatchRow): void {
        this.activeManualMatchRowId.set(row.rowId);
        this.manualMatchQuery.set(row.receiptName);
        this.manualSearchErrorMessage.set(null);

        if (this.allGrocyProducts().length === 0) {
            this.loadAllGrocyProducts();
        }
    }

    protected closeManualMatchModal(): void {
        this.activeManualMatchRowId.set(null);
        this.manualMatchQuery.set('');
        this.manualSearchErrorMessage.set(null);
    }

    protected updateManualMatchQuery(value: string): void {
        this.manualMatchQuery.set(value);
    }

    protected selectProductFromModal(product: GrocySearchProduct): void {
        const activeRow = this.activeManualMatchRow();
        if (!activeRow) {
            return;
        }

        const updatedRows = this.matchRows().map((row) => {
            if (row.rowId !== activeRow.rowId) {
                return row;
            }

            const candidateAlreadyPresent = row.candidates.some(
                (candidate) => candidate.productId === product.id,
            );
            const updatedCandidates = candidateAlreadyPresent
                ? row.candidates
                : [{ productId: product.id, productName: product.name, score: 1 }, ...row.candidates];

            return {
                ...row,
                selectedProductId: product.id,
                selectedProductName: product.name,
                selectedScore: 1,
                autoAccepted: false,
                mappedFromHistory: false,
                candidates: updatedCandidates,
            };
        });

        this.matchRows.set(updatedRows);
        this.saveMappingsMessage.set(null);
        this.closeManualMatchModal();
    }

    private loadMatchCandidates(parsed: ParsedReceiptResponse): void {
        this.isMatching.set(true);
        this.matchErrorMessage.set(null);
        this.saveMappingsMessage.set(null);
        this.storeName.set(parsed.storeName);

        this.http
            .post<MatchCandidatesResponse>(this.apiEndpoints.spesaMatchCandidates(), {
                storeName: parsed.storeName,
                items: this.getUniqueReceiptItems(parsed.items),
            })
            .subscribe({
                next: (response) => {
                    const rows = response.results.map((result, index) => ({
                        ...result,
                        rowId: index,
                    }));

                    this.matchRows.set(rows);
                    this.grocyProductsPageUrl.set(response.grocyProductsPageUrl.replace('products', 'product') + '/new');
                    this.highConfidenceThreshold.set(response.highConfidenceThreshold);
                    this.isMatching.set(false);
                },
                error: () => {
                    this.matchRows.set([]);
                    this.matchErrorMessage.set('Impossibile calcolare i suggerimenti di abbinamento.');
                    this.isMatching.set(false);
                },
            });
    }

    private loadAllGrocyProducts(): void {
        this.isLoadingManualSearchProducts.set(true);
        this.manualSearchErrorMessage.set(null);

        this.http
            .get<unknown[]>(this.apiEndpoints.products(), { context: withHttpCache(true) })
            .subscribe({
                next: (response) => {
                    const parsedProducts = this.parseGrocyProducts(response);
                    this.allGrocyProducts.set(parsedProducts);
                    this.isLoadingManualSearchProducts.set(false);
                },
                error: () => {
                    this.allGrocyProducts.set([]);
                    this.isLoadingManualSearchProducts.set(false);
                    this.manualSearchErrorMessage.set('Impossibile caricare i prodotti Grocy.');
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
                picture_file_name: typeof record['picture_file_name'] === 'string' ? record['picture_file_name'] : null,
                userfields: record['userfields'] && typeof record['userfields'] === 'object'
                    ? (record['userfields'] as Item['userfields'])
                    : null,
            });
        }

        return products.sort((left, right) => left.name.localeCompare(right.name, 'it'));
    }

    private normalizeSearchValue(value: string): string {
        return value.toUpperCase().replace(/\s+/g, ' ').trim();
    }

    private normalizeForMatching(value: string): string {
        return value
            .toUpperCase()
            .replace(/[^A-Z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    private triggerMappingsSavedFeedback(): void {
        this.isMappingsSaved.set(true);

        if (this.mappingsSaveFeedbackTimeoutId !== null) {
            clearTimeout(this.mappingsSaveFeedbackTimeoutId);
        }

        if (typeof window !== 'undefined') {
            this.mappingsSaveFeedbackTimeoutId = window.setTimeout(() => {
                this.isMappingsSaved.set(false);
            }, 1800);
        }
    }

    private triggerReceiptSavedFeedback(): void {
        this.isReceiptSaved.set(true);

        if (this.receiptSaveFeedbackTimeoutId !== null) {
            clearTimeout(this.receiptSaveFeedbackTimeoutId);
        }

        if (typeof window !== 'undefined') {
            this.receiptSaveFeedbackTimeoutId = window.setTimeout(() => {
                this.isReceiptSaved.set(false);
            }, 1800);
        }
    }

    private getUniqueReceiptItems(items: ParsedReceiptItem[]): Array<{ name: string }> {
        const uniqueNames = new Map<string, string>();

        for (const item of items) {
            const receiptName = item.name.trim();
            if (!receiptName) {
                continue;
            }

            const key = receiptName.toUpperCase().replace(/\s+/g, ' ').trim();
            if (!uniqueNames.has(key)) {
                uniqueNames.set(key, receiptName);
            }
        }

        return [...uniqueNames.values()].map((name) => ({ name }));
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
}
