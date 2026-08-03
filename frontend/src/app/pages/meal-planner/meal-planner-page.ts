import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { LucideCheck, LucideCircle, LucideDynamicIcon, LucideMinus, LucideOctagonAlert } from '@lucide/angular';
import { catchError, forkJoin, of } from 'rxjs';
import { ApiEndpointsService } from '../../api/api-endpoints';
import { BackButtonComponent } from '../../components/back-button/back-button';
import { ItemCardComponent, ItemConsumedEvent } from '../../components/item-card/item-card';
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
  KNOWN_MEAL_PLANNER_CATEGORY_LABELS,
  KNOWN_MEAL_PLANNER_CATEGORY_OPTIONS,
  KNOWN_MEAL_PLANNER_CATEGORY_SET,
  MEAL_PLANNER_CATEGORY,
  KnownMealPlannerCategoryKey,
  guessMealPlannerCategory,
  isExcludedMacroCategory,
  normalizeMacroCategoryName,
} from '../shared/macro-category-mapping';

const CAT = MEAL_PLANNER_CATEGORY;
type KnownCategoryKey = KnownMealPlannerCategoryKey;

type PyramidLevel = 'base' | 'daily' | 'weekly' | 'occasional';

interface CategoryGroup {
  key: string;
  label: string;
  items: Item[];
  pyramidLevel: PyramidLevel;
  pyramidLevelLabel: string;
}

interface ApiCategory {
  key: string;
  label: string;
}

interface MealRuleResult {
  id: string;
  label: string;
  tip: string;
  priority: 'required' | 'recommended' | 'optional';
  satisfied: boolean;
}

type ModalCategoryViewItem = ItemWithStockSummary;

const PYRAMID_LEVELS: Partial<Record<KnownCategoryKey, PyramidLevel>> = {
  [CAT.VERDURA]: 'base',
  [CAT.FRUTTA_FRESCA]: 'base',
  [CAT.CEREALI]: 'base',
  [CAT.LATTICINI]: 'daily',
  [CAT.GRASSI]: 'daily',
  [CAT.FRUTTA_SECCA]: 'daily',
  [CAT.LEGUMI]: 'weekly',
  [CAT.PROTEINE_ANIMALI]: 'weekly',
  [CAT.PROTEINE_VEGETALI]: 'weekly',
};

const PYRAMID_LEVEL_LABELS: Record<PyramidLevel, string> = {
  base: 'Ad ogni pasto',
  daily: 'Ogni giorno',
  weekly: 'Settimanale',
  occasional: 'Con moderazione',
};

const PYRAMID_LEVEL_ORDER: Record<PyramidLevel, number> = {
  base: 0,
  daily: 1,
  weekly: 2,
  occasional: 3,
};

const CATEGORY_MAPPING_STORAGE_KEY = 'meal-planner-category-mapping-v1';
const MEAL_SELECTION_STORAGE_KEY = 'meal-planner-selected-items-v1';
const MEAL_SELECTION_MAX_AGE_MS = 8 * 60 * 60 * 1000;

interface PersistedMealSelection {
  itemIds: number[];
  savedAt: number;
}

@Component({
  selector: 'app-meal-planner-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LoadingSpinnerComponent, LucideDynamicIcon, ItemCardComponent],
  templateUrl: './meal-planner-page.html',
  styleUrl: './meal-planner-page.scss',
  host: {
    '(document:keydown.escape)': 'onEscapeKey($event)',
  },
})
export class MealPlannerPage {
  private readonly http = inject(HttpClient);
  private readonly apiEndpoints = inject(ApiEndpointsService);
  private saveFeedbackTimeoutId: ReturnType<typeof setTimeout> | null = null;

  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly allItems = signal<Item[]>([]);
  protected readonly stockEntries = signal<StockEntry[]>([]);
  protected readonly selectedItemIds = signal<ReadonlySet<number>>(new Set());
  protected readonly requiresCategoryMapping = signal(false);
  protected readonly apiCategories = signal<ApiCategory[]>([]);
  protected readonly categoryMappingDraft = signal<Record<string, KnownCategoryKey | ''>>({});
  protected readonly categoryMapping = signal<ReadonlyMap<string, KnownCategoryKey>>(new Map());
  protected readonly activeModalCategory = signal<CategoryGroup | null>(null);
  protected readonly modalSelectedItemIds = signal<ReadonlySet<number>>(new Set());
  protected readonly isMealSelectionSaved = signal(false);
  protected readonly hasPersistedMealSelection = signal(false);
  protected readonly knownCategoryOptions = KNOWN_MEAL_PLANNER_CATEGORY_OPTIONS;
  protected readonly stockSummaryOverrides = signal<ReadonlyMap<number, ProductStockSummary>>(new Map());
  protected readonly saveSuccessIcon = LucideCheck;
  protected readonly ruleOkIcon = LucideCheck;
  protected readonly ruleRequiredIcon = LucideOctagonAlert;
  protected readonly ruleRecommendedIcon = LucideMinus;
  protected readonly ruleOptionalIcon = LucideCircle;

  protected readonly canSaveCategoryMapping = computed(() =>
    this.apiCategories().every((apiCategory) => {
      const mappedCategory = this.categoryMappingDraft()[apiCategory.key];
      return mappedCategory !== undefined && mappedCategory !== '';
    }),
  );

  protected readonly categoryGroups = computed<CategoryGroup[]>(() => {
    const mapping = this.categoryMapping();
    const grouped = new Map<string, Item[]>();
    for (const item of this.allItems()) {
      const mappedCategory = this.getMappedCategory(item, mapping);
      if (!mappedCategory) continue;
      if (!grouped.has(mappedCategory)) grouped.set(mappedCategory, []);
      grouped.get(mappedCategory)!.push(item);
    }

    return Array.from(grouped.entries())
      .map(([key, items]): CategoryGroup => {
        const level = PYRAMID_LEVELS[key as KnownCategoryKey] ?? 'occasional';
        return {
          key,
            label: KNOWN_MEAL_PLANNER_CATEGORY_LABELS[key as KnownCategoryKey] ?? key,
          items: [...items].sort((a, b) => a.name.localeCompare(b.name, 'it')),
          pyramidLevel: level,
          pyramidLevelLabel: PYRAMID_LEVEL_LABELS[level],
        };
      })
      .sort(
        (a, b) =>
          PYRAMID_LEVEL_ORDER[a.pyramidLevel] - PYRAMID_LEVEL_ORDER[b.pyramidLevel] ||
          a.label.localeCompare(b.label, 'it'),
      );
  });

  protected readonly selectedItems = computed<Item[]>(() => {
    const ids = this.selectedItemIds();
    return this.allItems().filter((item) => ids.has(item.id));
  });

  protected readonly selectedItemCountByCategory = computed<ReadonlyMap<string, number>>(() => {
    const selectedIds = this.selectedItemIds();
    const mapping = this.categoryMapping();
    const counts = new Map<string, number>();

    for (const item of this.allItems()) {
      if (!selectedIds.has(item.id)) {
        continue;
      }

      const mappedCategory = this.getMappedCategory(item, mapping);
      if (!mappedCategory) {
        continue;
      }

      counts.set(mappedCategory, (counts.get(mappedCategory) ?? 0) + 1);
    }

    return counts;
  });

  protected readonly availableItemCountByCategory = computed<ReadonlyMap<string, number>>(() => {
    const mapping = this.categoryMapping();
    const stockSummaryByProductId = this.stockSummaryByProductId();
    const counts = new Map<string, number>();

    for (const item of this.allItems()) {
      const mappedCategory = this.getMappedCategory(item, mapping);
      if (!mappedCategory) {
        continue;
      }

      const stockSummary = stockSummaryByProductId.get(item.id);
      const isAvailableInPantry =
        (stockSummary?.amount ?? 0) > 0 ||
        (stockSummary?.amountOpened ?? 0) > 0;

      if (!isAvailableInPantry) {
        continue;
      }

      counts.set(mappedCategory, (counts.get(mappedCategory) ?? 0) + 1);
    }

    return counts;
  });

  protected readonly modalSelectionCount = computed(() => this.modalSelectedItemIds().size);

  protected readonly stockSummaryByProductId = computed<Map<number, ProductStockSummary>>(() =>
    this.mergeStockSummaryOverrides(
      buildStockSummaryByProductId(this.stockEntries()),
      this.stockSummaryOverrides(),
    ),
  );

  protected readonly modalSortedItems = computed<ModalCategoryViewItem[]>(() => {
    const activeCategory = this.activeModalCategory();
    if (!activeCategory) {
      return [];
    }

    const stockSummaryByProductId = this.stockSummaryByProductId();

    return mapItemsWithStockSummary(activeCategory.items, stockSummaryByProductId)
      .filter((item) => item.stockSummary.amount > 0 || item.stockSummary.amountOpened > 0);
  });

  protected readonly selectedMappedCategories = computed<ReadonlySet<KnownCategoryKey>>(() => {
    const categories = new Set<KnownCategoryKey>();
    const mapping = this.categoryMapping();

    for (const item of this.selectedItems()) {
      const mappedCategory = this.getMappedCategory(item, mapping);
      if (mappedCategory) {
        categories.add(mappedCategory);
      }
    }

    return categories;
  });

  protected readonly mealRules = computed<MealRuleResult[]>(() => {
    const mappedCategories = this.selectedMappedCategories();
    return [
      {
        id: 'verdura',
        label: 'Verdura',
        tip: 'Aggiungi delle verdure: sono alla base della piramide mediterranea',
        priority: 'required' as const,
        satisfied: mappedCategories.has(CAT.VERDURA),
      },
      {
        id: 'cereali',
        label: 'Cereali o derivati',
        tip: 'Aggiungi pasta, pane o riso (preferibilmente integrali)',
        priority: 'required' as const,
        satisfied: mappedCategories.has(CAT.CEREALI),
      },
      {
        id: 'proteine',
        label: 'Fonte proteica',
        tip: 'Aggiungi legumi, pesce, carne o proteine vegetali',
        priority: 'required' as const,
        satisfied:
          mappedCategories.has(CAT.LEGUMI) ||
          mappedCategories.has(CAT.PROTEINE_ANIMALI) ||
          mappedCategories.has(CAT.PROTEINE_VEGETALI),
      },
      {
        id: 'grassi',
        label: 'Grassi buoni',
        tip: 'Considera olio EVO, olive o frutta secca come condimento',
        priority: 'recommended' as const,
        satisfied: mappedCategories.has(CAT.GRASSI) || mappedCategories.has(CAT.FRUTTA_SECCA),
      },
      {
        id: 'frutta',
        label: 'Frutta fresca',
        tip: 'Aggiungi frutta fresca come dessert o chiusura pasto',
        priority: 'optional' as const,
        satisfied: mappedCategories.has(CAT.FRUTTA_FRESCA),
      },
    ];
  });

  protected readonly requiredRules = computed(() =>
    this.mealRules().filter((r) => r.priority === 'required'),
  );

  protected readonly completionScore = computed(() => {
    const required = this.requiredRules();
    const satisfied = required.filter((r) => r.satisfied).length;
    return Math.round((satisfied / required.length) * 100);
  });

  protected readonly isComplete = computed(() => this.completionScore() === 100);

  protected readonly unsatisfiedRequired = computed(() =>
    this.mealRules().filter((r) => r.priority === 'required' && !r.satisfied),
  );

  protected readonly unsatisfiedRecommended = computed(() =>
    this.mealRules().filter((r) => r.priority === 'recommended' && !r.satisfied),
  );

  constructor() {
    this.loadItems();
  }

  protected isItemSelected(itemId: number): boolean {
    return this.selectedItemIds().has(itemId);
  }

  protected toggleItem(item: Item): void {
    this.selectedItemIds.update((set) => {
      const next = new Set(set);
      if (next.has(item.id)) {
        next.delete(item.id);
      } else {
        next.add(item.id);
      }
      return next;
    });
  }

  protected openCategoryModal(group: CategoryGroup): void {
    this.activeModalCategory.set(group);
    this.modalSelectedItemIds.set(new Set());
  }

  protected closeCategoryModal(): void {
    this.activeModalCategory.set(null);
    this.modalSelectedItemIds.set(new Set());
  }

  protected isModalItemSelected(itemId: number): boolean {
    return this.modalSelectedItemIds().has(itemId);
  }

  protected toggleModalItem(itemId: number): void {
    this.modalSelectedItemIds.update((set) => {
      const next = new Set(set);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  }

  protected onModalItemCardClick(itemId: number, event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Element && target.closest('a, button, input, select, textarea')) {
      return;
    }

    this.toggleModalItem(itemId);
  }

  protected onModalItemCardKeydown(itemId: number, event: KeyboardEvent): void {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    this.toggleModalItem(itemId);
  }

  protected onEscapeKey(event: Event): void {
    if (!this.activeModalCategory()) {
      return;
    }

    if (!(event instanceof KeyboardEvent)) {
      return;
    }

    event.preventDefault();
    this.closeCategoryModal();
  }

  protected confirmModalSelection(): void {
    const modalSelection = this.modalSelectedItemIds();
    if (modalSelection.size > 0) {
      this.selectedItemIds.update((set) => {
        const next = new Set(set);
        for (const itemId of modalSelection) {
          next.add(itemId);
        }
        return next;
      });
    }

    this.closeCategoryModal();
  }

  protected onModalItemConsumed(event: ItemConsumedEvent): void {
    this.stockSummaryOverrides.update((overrides) => {
      const next = new Map(overrides);
      next.set(event.itemId, event.stockSummary);
      return next;
    });

    const hasAvailableUnits = event.stockSummary.amount > 0 || event.stockSummary.amountOpened > 0;
    if (!hasAvailableUnits) {
      this.modalSelectedItemIds.update((selectedIds) => {
        if (!selectedIds.has(event.itemId)) {
          return selectedIds;
        }

        const next = new Set(selectedIds);
        next.delete(event.itemId);
        return next;
      });
    }
  }

  protected getSelectedCountForCategory(key: string): number {
    return this.selectedItemCountByCategory().get(key) ?? 0;
  }

  protected getAvailableCountForCategory(key: string): number {
    return this.availableItemCountByCategory().get(key) ?? 0;
  }

  protected clearMeal(): void {
    this.selectedItemIds.set(new Set());
  }

  protected saveMealSelection(): void {
    this.persistMealSelection(this.selectedItemIds());
    this.isMealSelectionSaved.set(true);

    if (this.saveFeedbackTimeoutId !== null) {
      clearTimeout(this.saveFeedbackTimeoutId);
    }

    if (typeof window !== 'undefined') {
      this.saveFeedbackTimeoutId = window.setTimeout(() => {
        this.isMealSelectionSaved.set(false);
      }, 1800);
    }
  }

  protected clearSavedMealSelection(): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.removeItem(MEAL_SELECTION_STORAGE_KEY);
    this.hasPersistedMealSelection.set(false);
    this.isMealSelectionSaved.set(false);
  }

  protected reloadItems(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.loadItems();
  }

  protected getCategoryMappingValue(apiCategoryKey: string): KnownCategoryKey | '' {
    return this.categoryMappingDraft()[apiCategoryKey] ?? '';
  }

  protected getCategoryMappingControlId(apiCategoryKey: string): string {
    return `mapping-${apiCategoryKey.replace(/[^a-z0-9_-]/g, '-')}`;
  }

  protected onCategoryMappingChange(apiCategoryKey: string, event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }

    const selectedValue = target.value;
    const mappedCategory = KNOWN_MEAL_PLANNER_CATEGORY_SET.has(selectedValue as KnownCategoryKey)
      ? (selectedValue as KnownCategoryKey)
      : '';

    this.categoryMappingDraft.update((draft) => ({
      ...draft,
      [apiCategoryKey]: mappedCategory,
    }));
  }

  protected saveCategoryMapping(): void {
    if (!this.canSaveCategoryMapping()) {
      return;
    }

    const draft = this.categoryMappingDraft();
    const mapping = new Map<string, KnownCategoryKey>();

    for (const apiCategory of this.apiCategories()) {
      const mappedCategory = draft[apiCategory.key];
      if (!mappedCategory) {
        return;
      }
      mapping.set(apiCategory.key, mappedCategory);
    }

    this.categoryMapping.set(mapping);
    this.persistCategoryMapping(mapping);
    this.requiresCategoryMapping.set(false);
  }

  private loadItems(): void {
    forkJoin({
      products: this.http
        .get<Item[]>(this.apiEndpoints.products(), { context: withHttpCache(true) })
        .pipe(catchError(() => of(null))),
      stock: this.http
        .get<StockEntry[]>(this.apiEndpoints.stock(), { context: withHttpCache(true) })
        .pipe(catchError(() => of([]))),
    }).subscribe(({ products, stock }) => {
      if (products === null) {
        this.errorMessage.set('Impossibile caricare gli alimenti. Riprova più tardi.');
      } else {
        this.allItems.set(products);
        this.stockEntries.set(Array.isArray(stock) ? stock : []);
        this.stockSummaryOverrides.set(new Map());
        this.restoreSavedMealSelection(products);
        this.initializeCategoryMapping(products);
      }
      this.isLoading.set(false);
    });
  }

  private mergeStockSummaryOverrides(
    baseSummaryByProductId: Map<number, ProductStockSummary>,
    overrideSummaryByProductId: ReadonlyMap<number, ProductStockSummary>,
  ): Map<number, ProductStockSummary> {
    if (overrideSummaryByProductId.size === 0) {
      return baseSummaryByProductId;
    }

    const mergedSummary = new Map(baseSummaryByProductId);
    for (const [productId, stockSummary] of overrideSummaryByProductId.entries()) {
      mergedSummary.set(productId, stockSummary);
    }

    return mergedSummary;
  }

  private initializeCategoryMapping(items: Item[]): void {
    const apiCategories = this.extractApiCategories(items);
    this.apiCategories.set(apiCategories);

    if (apiCategories.length === 0) {
      this.categoryMapping.set(new Map());
      this.categoryMappingDraft.set({});
      this.requiresCategoryMapping.set(false);
      return;
    }

    const storedMapping = this.readStoredCategoryMapping();
    const resolvedMapping = new Map<string, KnownCategoryKey>();

    for (const apiCategory of apiCategories) {
      const mappedCategory = storedMapping.get(apiCategory.key);
      if (mappedCategory) {
        resolvedMapping.set(apiCategory.key, mappedCategory);
      }
    }

    this.categoryMapping.set(resolvedMapping);

    if (resolvedMapping.size === apiCategories.length) {
      this.requiresCategoryMapping.set(false);
      return;
    }

    const initialDraft: Record<string, KnownCategoryKey | ''> = {};
    for (const apiCategory of apiCategories) {
      initialDraft[apiCategory.key] =
        resolvedMapping.get(apiCategory.key) ??
        guessMealPlannerCategory(apiCategory.label) ??
        '';
    }

    this.categoryMappingDraft.set(initialDraft);
    this.requiresCategoryMapping.set(true);
  }

  private extractApiCategories(items: Item[]): ApiCategory[] {
    const categoriesByKey = new Map<string, string>();

    for (const item of items) {
      const rawCategory = item.userfields?.food_macrocategory?.trim();
      if (!rawCategory || isExcludedMacroCategory(rawCategory)) {
        continue;
      }

      const key = normalizeMacroCategoryName(rawCategory);
      if (!categoriesByKey.has(key)) {
        categoriesByKey.set(key, rawCategory);
      }
    }

    return Array.from(categoriesByKey.entries())
      .map(([key, label]) => ({ key, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'it'));
  }

  private readStoredCategoryMapping(): Map<string, KnownCategoryKey> {
    if (typeof window === 'undefined') {
      return new Map();
    }

    try {
      const rawValue = window.localStorage.getItem(CATEGORY_MAPPING_STORAGE_KEY);
      if (!rawValue) {
        return new Map();
      }

      const parsedValue = JSON.parse(rawValue) as Record<string, unknown>;
      const mapping = new Map<string, KnownCategoryKey>();

      for (const [apiCategory, mappedCategory] of Object.entries(parsedValue)) {
        if (
          typeof apiCategory === 'string' &&
          typeof mappedCategory === 'string' &&
          KNOWN_MEAL_PLANNER_CATEGORY_SET.has(mappedCategory as KnownCategoryKey)
        ) {
          mapping.set(normalizeMacroCategoryName(apiCategory), mappedCategory as KnownCategoryKey);
        }
      }

      return mapping;
    } catch {
      return new Map();
    }
  }

  private persistCategoryMapping(mapping: ReadonlyMap<string, KnownCategoryKey>): void {
    if (typeof window === 'undefined') {
      return;
    }

    const serializableMapping: Record<string, KnownCategoryKey> = {};
    for (const [apiCategory, mappedCategory] of mapping.entries()) {
      serializableMapping[apiCategory] = mappedCategory;
    }

    window.localStorage.setItem(CATEGORY_MAPPING_STORAGE_KEY, JSON.stringify(serializableMapping));
  }

  private restoreSavedMealSelection(items: Item[]): void {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      const rawValue = window.localStorage.getItem(MEAL_SELECTION_STORAGE_KEY);
      if (!rawValue) {
        return;
      }

      const parsedValue = JSON.parse(rawValue) as unknown;
      const persistedSelection = this.parsePersistedMealSelection(parsedValue);
      if (!persistedSelection) {
        window.localStorage.removeItem(MEAL_SELECTION_STORAGE_KEY);
        this.hasPersistedMealSelection.set(false);
        return;
      }

      if (Date.now() - persistedSelection.savedAt > MEAL_SELECTION_MAX_AGE_MS) {
        window.localStorage.removeItem(MEAL_SELECTION_STORAGE_KEY);
        this.hasPersistedMealSelection.set(false);
        return;
      }

      this.hasPersistedMealSelection.set(true);

      const existingItemIds = new Set(items.map((item) => item.id));
      const restoredIds = persistedSelection.itemIds
        .filter((itemId) => existingItemIds.has(itemId));

      this.selectedItemIds.set(new Set(restoredIds));

      if (restoredIds.length !== persistedSelection.itemIds.length) {
        this.persistMealSelection(new Set(restoredIds), persistedSelection.savedAt);
      }
    } catch {
      // Ignore invalid persisted payloads.
      this.hasPersistedMealSelection.set(false);
    }
  }

  private persistMealSelection(itemIds: ReadonlySet<number>, savedAt = Date.now()): void {
    if (typeof window === 'undefined') {
      return;
    }

    const payload: PersistedMealSelection = {
      itemIds: Array.from(itemIds),
      savedAt,
    };

    window.localStorage.setItem(MEAL_SELECTION_STORAGE_KEY, JSON.stringify(payload));
    this.hasPersistedMealSelection.set(true);
  }

  private parsePersistedMealSelection(parsedValue: unknown): PersistedMealSelection | null {
    if (Array.isArray(parsedValue)) {
      const itemIds = parsedValue
        .filter((value): value is number => typeof value === 'number' && Number.isInteger(value));
      const migratedSelection: PersistedMealSelection = {
        itemIds,
        savedAt: Date.now(),
      };

      this.persistMealSelection(new Set(itemIds), migratedSelection.savedAt);
      return migratedSelection;
    }

    if (!parsedValue || typeof parsedValue !== 'object') {
      return null;
    }

    const candidate = parsedValue as Partial<PersistedMealSelection>;
    if (!Array.isArray(candidate.itemIds) || typeof candidate.savedAt !== 'number') {
      return null;
    }

    const itemIds = candidate.itemIds
      .filter((value): value is number => typeof value === 'number' && Number.isInteger(value));

    if (!Number.isFinite(candidate.savedAt)) {
      return null;
    }

    return {
      itemIds,
      savedAt: candidate.savedAt,
    };
  }

  private getMappedCategory(
    item: Item,
    mapping: ReadonlyMap<string, KnownCategoryKey>,
  ): KnownCategoryKey | null {
    const category = item.userfields?.food_macrocategory;
    if (!category) {
      return null;
    }

    return mapping.get(normalizeMacroCategoryName(category)) ?? null;
  }
}
