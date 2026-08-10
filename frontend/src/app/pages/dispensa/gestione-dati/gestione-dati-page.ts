import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import {
  LucideCheck,
  LucideDynamicIcon,
  LucideExternalLink,
  LucideFolderPlus,
  LucideRefreshCw,
  LucideSave,
  LucideStar,
  LucideStarOff,
} from '@lucide/angular';
import { BackButtonComponent } from '../../../components/back-button/back-button';
import { ApiEndpointsService } from '../../../api/api-endpoints';
import { withHttpCache } from '../../../interceptors/http-cache.interceptor';
import { Item } from '../../shared/product-shared';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';

type SortColumn =
  | 'name'
  | 'parentProduct'
  | 'foodMacrocategory'
  | 'yukaScore'
  | 'tastesGood'
  | 'rowCreatedTimestamp';
type SortDirection = 'asc' | 'desc';

interface DataManagementUserfields {
  food_macrocategory?: string | null;
  yuka_score?: number | string | null;
  tastes_good?: number | string | null;
  is_parent_product?: number | string | null;
}

interface GrocyProductRecord extends Item {
  parent_product_id?: number | string | null;
  product_group_id?: number | string | null;
  row_created_timestamp?: string | null;
  userfields?: Record<string, unknown> | null;
  sourceRecord: Record<string, unknown>;
}

interface EditableProductSnapshot {
  name: string;
  parentProductId: number | null;
  foodMacrocategory: string | null;
  yukaScore: number | null;
  tastesGood: number | null;
}

interface EditableProductRow {
  id: number;
  pictureFileName: string | null;
  rowCreatedTimestamp: string | null;
  sourceRecord: Record<string, unknown>;
  name: string;
  parentProductId: number | null;
  foodMacrocategory: string | null;
  yukaScore: number | null;
  tastesGood: number | null;
  original: EditableProductSnapshot;
}

interface SaveRowResult {
  id: number;
  ok: boolean;
}

interface ParentProductOption {
  id: number;
  name: string;
  minStockAmount: number | null;
}

@Component({
  selector: 'app-gestione-dati-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LucideDynamicIcon],
  templateUrl: './gestione-dati-page.html',
  styleUrl: './gestione-dati-page.scss',
  host: {
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class GestioneDatiPage {
  private readonly http = inject(HttpClient);
  private readonly apiEndpoints = inject(ApiEndpointsService);
  private readonly rowCreatedTimestampFormatter = new Intl.DateTimeFormat(navigator.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  private saveMessageTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private saveSuccessTimeoutId: ReturnType<typeof setTimeout> | null = null;

  protected readonly isLoading = signal(true);
  protected readonly isReloadingParentProducts = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly loadErrorMessage = signal<string | null>(null);
  protected readonly actionErrorMessage = signal<string | null>(null);
  protected readonly saveMessage = signal<string | null>(null);
  protected readonly sortColumn = signal<SortColumn>('rowCreatedTimestamp');
  protected readonly sortDirection = signal<SortDirection>('desc');
  protected readonly parentProducts = signal<ReadonlyArray<ParentProductOption>>([]);
  protected readonly editableRows = signal<EditableProductRow[]>([]);
  protected readonly starOptions = [1, 2, 3, 4, 5] as const;
  protected readonly pageSizeOptions = [20, 50, 100] as const;
  protected readonly pageSize = signal<number>(20);
  protected readonly currentPage = signal<number>(1);
  protected readonly searchQuery = signal('');
  protected readonly createParentProductUrl = this.apiEndpoints.grocyNewProductPage();
  protected readonly isSaveSuccess = signal(false);
  protected readonly openIcon = LucideExternalLink;
  protected readonly starIcon = LucideStar;
  protected readonly starOffIcon = LucideStarOff;
  protected readonly newParentProductIcon = LucideFolderPlus;
  protected readonly refreshIcon = LucideRefreshCw;
  protected readonly saveIcon = LucideSave;
  protected readonly checkIcon = LucideCheck;

  protected readonly hasChanges = computed(() => this.editableRows().some((row) => this.isRowChanged(row)));

  protected readonly macroCategoryOptions = computed(() => {
    const normalizedCategories = new Map<string, string>();

    for (const row of this.editableRows()) {
      const category = row.foodMacrocategory?.trim();
      if (!category) {
        continue;
      }

      const normalized = category.toLocaleLowerCase();
      if (!normalizedCategories.has(normalized)) {
        normalizedCategories.set(normalized, category);
      }
    }

    return [...normalizedCategories.values()].sort((left, right) => left.localeCompare(right, 'it'));
  });

  protected readonly sortedRows = computed(() => {
    const rows = [...this.editableRows()];
    const directionFactor = this.sortDirection() === 'asc' ? 1 : -1;
    const parentById = new Map(this.parentProducts().map((parentProduct) => [parentProduct.id, parentProduct.name]));

    rows.sort((leftRow, rightRow) => {
      const leftValue = this.getSortValue(leftRow, parentById, this.sortColumn());
      const rightValue = this.getSortValue(rightRow, parentById, this.sortColumn());

      // Keep empty values at the bottom regardless of sorting direction.
      if (leftValue === null && rightValue !== null) {
        return 1;
      }

      if (leftValue !== null && rightValue === null) {
        return -1;
      }

      const comparison = this.compareSortValues(leftValue, rightValue);

      if (comparison !== 0) {
        return comparison * directionFactor;
      }

      return leftRow.name.localeCompare(rightRow.name, 'it') * directionFactor;
    });

    return rows;
  });

  protected readonly filteredRows = computed(() => {
    const normalizedQuery = this.normalizeSearchValue(this.searchQuery());
    if (!normalizedQuery) {
      return this.sortedRows();
    }

    const queryTokens = normalizedQuery.split(' ').filter(Boolean);
    return this.sortedRows().filter((row) => this.matchesSearchQuery(row.name, normalizedQuery, queryTokens));
  });

  protected readonly totalItems = computed(() => this.filteredRows().length);
  protected readonly totalPages = computed(() => Math.max(1, Math.ceil(this.totalItems() / this.pageSize())));
  protected readonly currentPageSafe = computed(() => Math.min(this.currentPage(), this.totalPages()));
  protected readonly paginatedRows = computed(() => {
    const pageSize = this.pageSize();
    const page = this.currentPageSafe();
    const startIndex = (page - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    return this.filteredRows().slice(startIndex, endIndex);
  });
  protected readonly pageStartItemIndex = computed(() => {
    if (this.totalItems() === 0) {
      return 0;
    }

    return (this.currentPageSafe() - 1) * this.pageSize() + 1;
  });
  protected readonly pageEndItemIndex = computed(() => {
    if (this.totalItems() === 0) {
      return 0;
    }

    return Math.min(this.currentPageSafe() * this.pageSize(), this.totalItems());
  });
  protected readonly hasInvalidChangedRows = computed(() =>
    this.editableRows().some((row) => this.isRowChanged(row) && this.isFoodMacrocategoryMissing(row)),
  );

  constructor() {
    this.loadProducts();
  }

  protected retryLoadProducts(): void {
    this.loadProducts(false);
  }

  protected reloadProducts(): void {
    this.reloadParentProducts();
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasChanges() || this.isSaving()) {
      return;
    }

    event.preventDefault();
    event.returnValue = '';
  }

  protected onPageSizeChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const parsedValue = Number(target.value);
    if (!this.pageSizeOptions.includes(parsedValue as (typeof this.pageSizeOptions)[number])) {
      return;
    }

    this.pageSize.set(parsedValue);
    this.currentPage.set(1);
  }

  protected onSearchQueryChange(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    this.searchQuery.set(target.value);
    this.currentPage.set(1);
  }

  protected goToPreviousPage(): void {
    const previousPage = this.currentPageSafe() - 1;
    this.currentPage.set(previousPage < 1 ? 1 : previousPage);
  }

  protected goToNextPage(): void {
    const nextPage = this.currentPageSafe() + 1;
    this.currentPage.set(nextPage > this.totalPages() ? this.totalPages() : nextPage);
  }

  protected toggleSort(column: SortColumn): void {
    if (this.sortColumn() === column) {
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
      this.currentPage.set(1);
      return;
    }

    this.sortColumn.set(column);
    this.sortDirection.set('asc');
    this.currentPage.set(1);
  }

  protected getSortDirectionLabel(column: SortColumn): string {
    if (this.sortColumn() !== column) {
      return '';
    }

    return this.sortDirection() === 'asc' ? '▲' : '▼';
  }

  protected getParentProductName(parentProductId: number | null): string {
    if (parentProductId === null) {
      return '';
    }

    return this.parentProducts().find((parentProduct) => parentProduct.id === parentProductId)?.name ?? '';
  }

  protected onNameChange(rowId: number, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    this.updateRow(rowId, {
      name: target.value,
    });
  }

  protected onParentProductChange(rowId: number, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const parsedValue = this.toOptionalInteger(target.value);
    this.updateRow(rowId, {
      parentProductId: parsedValue,
    });
  }

  protected onFoodMacrocategoryChange(rowId: number, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const category = target.value.trim();
    this.updateRow(rowId, {
      foodMacrocategory: category ? category : null,
    });
  }

  protected onYukaScoreChange(rowId: number, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    this.updateRow(rowId, {
      yukaScore: this.parseBoundedInteger(target.value, 0, 100),
    });
  }

  protected setTastesGood(rowId: number, value: number | null): void {
    this.updateRow(rowId, {
      tastesGood: value,
    });
  }

  protected getPictureUrl(pictureFileName: string | null): string | null {
    const normalizedPictureFileName = pictureFileName?.trim();
    if (!normalizedPictureFileName) {
      return null;
    }

    return this.apiEndpoints.productPictureByBase64(this.encodeFileNameToBase64(normalizedPictureFileName));
  }

  protected getProductEditUrl(productId: number): string {
    return this.apiEndpoints.productPage(productId);
  }

  protected formatRowCreatedTimestamp(value: string | null): string {
    const rawValue = value?.trim();
    if (!rawValue) {
      return '-';
    }

    const parsedDate = new Date(rawValue);
    if (Number.isNaN(parsedDate.getTime())) {
      return '-';
    }

    return this.rowCreatedTimestampFormatter.format(parsedDate);
  }

  protected saveChanges(): void {
    if (this.isSaving()) {
      return;
    }

    const changedRows = this.editableRows().filter((row) => this.isRowChanged(row));
    if (changedRows.length === 0) {
      return;
    }

    const rowsMissingFoodMacrocategory = changedRows.filter((row) => this.isFoodMacrocategoryMissing(row));
    if (rowsMissingFoodMacrocategory.length > 0) {
      this.saveMessage.set(null);
      this.actionErrorMessage.set('categoria food planner e obbligatorio per tutte le righe modificate.');
      return;
    }

    this.isSaving.set(true);
    this.saveMessage.set(null);
    this.actionErrorMessage.set(null);
    this.isSaveSuccess.set(false);

    const requests = changedRows.map((row) => {
      const objectPayload = this.buildObjectUpdatePayload(row);
      const userfieldsPayload = this.buildUserfieldsUpdatePayload(row);

      return this.http
        .put(this.apiEndpoints.grocyObject('products', row.id), objectPayload)
        .pipe(
          switchMap(() => {
            if (!this.hasUserfieldsChanges(row)) {
              return of(null);
            }

            return this.http.put(this.apiEndpoints.grocyObjectUserfields('products', row.id), userfieldsPayload);
          }),
          map((): SaveRowResult => ({ id: row.id, ok: true })),
          catchError(() => of<SaveRowResult>({ id: row.id, ok: false })),
        );
    });

    forkJoin(requests).subscribe({
      next: (results) => {
        const failedUpdates = results.filter((result) => !result.ok);

        if (failedUpdates.length === 0) {
          this.commitCurrentRowsAsOriginal();
          this.saveMessage.set(`Salvate ${results.length} righe modificate.`);
          this.scheduleSaveMessageClear();
          this.triggerSaveSuccessFeedback();
        } else {
          const succeededUpdatesCount = results.length - failedUpdates.length;
          if (succeededUpdatesCount > 0) {
            this.commitCurrentRowsAsOriginal(results.filter((result) => result.ok).map((result) => result.id));
          }

          this.actionErrorMessage.set(
            `Salvataggio parziale: ${succeededUpdatesCount} salvate, ${failedUpdates.length} con errore.`,
          );
        }

        this.isSaving.set(false);
      },
      error: () => {
        this.actionErrorMessage.set('Impossibile completare il salvataggio. Riprova.');
        this.isSaving.set(false);
      },
    });
  }

  private loadProducts(useCache = true, nextPage = 1): void {
    this.isLoading.set(true);
    this.loadErrorMessage.set(null);
    this.actionErrorMessage.set(null);
    this.saveMessage.set(null);
    this.currentPage.set(nextPage);

    this.http
      .get<unknown[]>(this.apiEndpoints.products(), { context: withHttpCache(useCache) })
      .subscribe({
        next: (response) => {
          const products = this.parseGrocyProducts(response);
          const parentProducts = this.buildParentProductOptions(products);

          const editableRows = products
            .filter((product) => !this.isParentProduct(product))
            .map((product) => this.toEditableRow(product));

          this.parentProducts.set(parentProducts);
          this.editableRows.set(editableRows);
          this.isLoading.set(false);
        },
        error: () => {
          this.parentProducts.set([]);
          this.editableRows.set([]);
          this.loadErrorMessage.set('Impossibile caricare i prodotti Grocy.');
          this.isLoading.set(false);
        },
      });
  }

  private reloadParentProducts(): void {
    this.isReloadingParentProducts.set(true);
    this.actionErrorMessage.set(null);

    this.http
      .get<unknown[]>(this.apiEndpoints.products(), { context: withHttpCache(false) })
      .subscribe({
        next: (response) => {
          const products = this.parseGrocyProducts(response);
          this.parentProducts.set(this.buildParentProductOptions(products));
          this.isReloadingParentProducts.set(false);
        },
        error: () => {
          this.actionErrorMessage.set('Impossibile ricaricare i parent product.');
          this.isReloadingParentProducts.set(false);
        },
      });
  }

  private buildParentProductOptions(products: GrocyProductRecord[]): ParentProductOption[] {
    return products
      .filter((product) => this.isParentProduct(product))
      .map((parentProduct) => ({
        id: parentProduct.id,
        name: parentProduct.name,
        minStockAmount: this.toOptionalNumber(parentProduct.sourceRecord['min_stock_amount']),
      }))
      .sort((leftParentProduct, rightParentProduct) =>
        leftParentProduct.name.localeCompare(rightParentProduct.name, 'it'),
      );
  }

  private parseGrocyProducts(payload: unknown[]): GrocyProductRecord[] {
    if (!Array.isArray(payload)) {
      return [];
    }

    const parsedProducts: GrocyProductRecord[] = [];

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

      parsedProducts.push({
        id,
        name,
        sourceRecord: { ...record },
        picture_file_name: typeof record['picture_file_name'] === 'string' ? record['picture_file_name'] : null,
        parent_product_id: this.toOptionalInteger(record['parent_product_id']),
        product_group_id: this.toOptionalInteger(record['product_group_id']),
        row_created_timestamp:
          typeof record['row_created_timestamp'] === 'string' ? record['row_created_timestamp'] : null,
        userfields:
          record['userfields'] && typeof record['userfields'] === 'object'
            ? (record['userfields'] as Record<string, unknown>)
            : null,
      });
    }

    return parsedProducts.sort((leftProduct, rightProduct) => leftProduct.name.localeCompare(rightProduct.name, 'it'));
  }

  private toEditableRow(product: GrocyProductRecord): EditableProductRow {
    const name = product.name;
    const parentProductId =
      this.toOptionalInteger(product.parent_product_id) ?? this.toOptionalInteger(product.product_group_id);
    const foodMacrocategory = this.toOptionalString(this.getUserfieldValue(product.userfields, 'food_macrocategory'));
    const yukaScore = this.parseBoundedInteger(this.getUserfieldValue(product.userfields, 'yuka_score'), 0, 100);
    const tastesGood = this.parseBoundedInteger(this.getUserfieldValue(product.userfields, 'tastes_good'), 1, 5);

    return {
      id: product.id,
      sourceRecord: { ...product.sourceRecord },
      pictureFileName: this.toOptionalString(product.picture_file_name),
      rowCreatedTimestamp: this.toOptionalString(product.row_created_timestamp),
      name,
      parentProductId,
      foodMacrocategory,
      yukaScore,
      tastesGood,
      original: {
        name,
        parentProductId,
        foodMacrocategory,
        yukaScore,
        tastesGood,
      },
    };
  }

  private updateRow(rowId: number, patch: Partial<Omit<EditableProductRow, 'id' | 'original'>>): void {
    this.isSaveSuccess.set(false);
    this.editableRows.update((rows) =>
      rows.map((row) => {
        if (row.id !== rowId) {
          return row;
        }

        return {
          ...row,
          ...patch,
        };
      }),
    );
  }

  private commitCurrentRowsAsOriginal(onlyRowIds?: number[]): void {
    const rowIdsToCommit = onlyRowIds ? new Set(onlyRowIds) : null;

    this.editableRows.update((rows) =>
      rows.map((row) => {
        if (rowIdsToCommit && !rowIdsToCommit.has(row.id)) {
          return row;
        }

        return {
          ...row,
          original: {
            name: row.name,
            parentProductId: row.parentProductId,
            foodMacrocategory: row.foodMacrocategory,
            yukaScore: row.yukaScore,
            tastesGood: row.tastesGood,
          },
        };
      }),
    );
  }

  private isParentProduct(product: GrocyProductRecord): boolean {
    return this.toOptionalInteger(this.getUserfieldValue(product.userfields, 'is_parent_product')) === 1;
  }

  protected isRowChanged(row: EditableProductRow): boolean {
    return (
      this.normalizeString(row.name) !== this.normalizeString(row.original.name) ||
      row.parentProductId !== row.original.parentProductId ||
      this.hasUserfieldsChanges(row)
    );
  }

  private hasUserfieldsChanges(row: EditableProductRow): boolean {
    return (
      this.normalizeString(row.foodMacrocategory) !== this.normalizeString(row.original.foodMacrocategory) ||
      row.yukaScore !== row.original.yukaScore ||
      row.tastesGood !== row.original.tastesGood
    );
  }

  protected isFoodMacrocategoryMissing(row: EditableProductRow): boolean {
    return this.normalizeString(row.foodMacrocategory) === '';
  }

  private buildObjectUpdatePayload(row: EditableProductRow): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      ...row.sourceRecord,
      name: row.name.trim(),
    };

    // Grocy object PUT on this instance fails when userfields is present in object payload.
    delete payload['userfields'];

    if (Object.prototype.hasOwnProperty.call(row.sourceRecord, 'parent_product_id')) {
      payload['parent_product_id'] = row.parentProductId;
    }

    if (
      Object.prototype.hasOwnProperty.call(row.sourceRecord, 'product_group_id') ||
      !Object.prototype.hasOwnProperty.call(row.sourceRecord, 'parent_product_id')
    ) {
      payload['product_group_id'] = row.parentProductId;
    }

    return payload;
  }

  private buildUserfieldsUpdatePayload(row: EditableProductRow): Record<string, unknown> {
    const originalUserfieldsRaw = row.sourceRecord['userfields'];
    const originalUserfields =
      originalUserfieldsRaw && typeof originalUserfieldsRaw === 'object'
        ? { ...(originalUserfieldsRaw as Record<string, unknown>) }
        : {};

    const nextUserfields: Record<string, unknown> = {
      ...originalUserfields,
      food_macrocategory: row.foodMacrocategory,
      yuka_score: row.yukaScore,
      tastes_good: row.tastesGood,
    };

    return nextUserfields;
  }

  private getUserfieldValue(userfields: Record<string, unknown> | null | undefined, key: string): unknown {
    if (!userfields || typeof userfields !== 'object') {
      return null;
    }

    return userfields[key] ?? null;
  }

  private getSortValue(
    row: EditableProductRow,
    parentById: Map<number, string>,
    column: SortColumn,
  ): string | number | null {
    switch (column) {
      case 'name':
        return this.normalizeString(row.name);
      case 'parentProduct':
        return this.normalizeString(row.parentProductId === null ? null : (parentById.get(row.parentProductId) ?? null));
      case 'foodMacrocategory':
        return this.normalizeString(row.foodMacrocategory);
      case 'yukaScore':
        return row.yukaScore;
      case 'tastesGood':
        return row.tastesGood;
      case 'rowCreatedTimestamp':
        return this.toTimestamp(row.rowCreatedTimestamp);
      default:
        return null;
    }
  }

  private compareSortValues(
    leftValue: string | number | null,
    rightValue: string | number | null,
  ): number {
    if (leftValue === null && rightValue === null) {
      return 0;
    }

    if (leftValue === null) {
      return 1;
    }

    if (rightValue === null) {
      return -1;
    }

    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return leftValue - rightValue;
    }

    return String(leftValue).localeCompare(String(rightValue), 'it');
  }

  private toTimestamp(value: string | null): number | null {
    if (!value) {
      return null;
    }

    const parsedDate = new Date(value);
    if (Number.isNaN(parsedDate.getTime())) {
      return null;
    }

    return parsedDate.getTime();
  }

  private toOptionalInteger(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsedNumber = Number(value);
    if (!Number.isInteger(parsedNumber)) {
      return null;
    }

    return parsedNumber;
  }

  private toOptionalNumber(value: unknown): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsedNumber = Number(value);
    if (!Number.isFinite(parsedNumber)) {
      return null;
    }

    return parsedNumber;
  }

  private parseBoundedInteger(value: unknown, minValue: number, maxValue: number): number | null {
    if (value === null || value === undefined || value === '') {
      return null;
    }

    const parsedValue = Number(value);
    if (!Number.isFinite(parsedValue)) {
      return null;
    }

    const roundedValue = Math.round(parsedValue);
    if (roundedValue < minValue || roundedValue > maxValue) {
      return null;
    }

    return roundedValue;
  }

  private toOptionalString(value: unknown): string | null {
    if (typeof value !== 'string') {
      return null;
    }

    const trimmedValue = value.trim();
    return trimmedValue ? trimmedValue : null;
  }

  private normalizeString(value: string | null): string {
    return value?.trim() ?? '';
  }

  private scheduleSaveMessageClear(): void {
    if (this.saveMessageTimeoutId !== null) {
      clearTimeout(this.saveMessageTimeoutId);
      this.saveMessageTimeoutId = null;
    }

    if (typeof window === 'undefined') {
      return;
    }

    this.saveMessageTimeoutId = window.setTimeout(() => {
      this.saveMessage.set(null);
      this.saveMessageTimeoutId = null;
    }, 5000);
  }

  private triggerSaveSuccessFeedback(): void {
    this.isSaveSuccess.set(true);

    if (this.saveSuccessTimeoutId !== null) {
      clearTimeout(this.saveSuccessTimeoutId);
      this.saveSuccessTimeoutId = null;
    }

    if (typeof window === 'undefined') {
      return;
    }

    this.saveSuccessTimeoutId = window.setTimeout(() => {
      this.isSaveSuccess.set(false);
      this.saveSuccessTimeoutId = null;
    }, 1800);
  }

  private normalizeSearchValue(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  private matchesSearchQuery(name: string, normalizedQuery: string, queryTokens: string[]): boolean {
    const normalizedName = this.normalizeSearchValue(name);

    // LIKE-style match.
    if (normalizedName.includes(normalizedQuery)) {
      return true;
    }

    // Fuzzy token match via subsequence.
    return queryTokens.every(
      (token) => normalizedName.includes(token) || this.isSubsequenceMatch(token, normalizedName),
    );
  }

  private isSubsequenceMatch(pattern: string, text: string): boolean {
    if (!pattern) {
      return true;
    }

    let patternIndex = 0;
    for (let textIndex = 0; textIndex < text.length; textIndex += 1) {
      if (text[textIndex] === pattern[patternIndex]) {
        patternIndex += 1;
        if (patternIndex === pattern.length) {
          return true;
        }
      }
    }

    return false;
  }

  private encodeFileNameToBase64(fileName: string): string {
    const utf8Bytes = new TextEncoder().encode(fileName);
    let binaryString = '';

    for (const byte of utf8Bytes) {
      binaryString += String.fromCharCode(byte);
    }

    return btoa(binaryString);
  }
}
