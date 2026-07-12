import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { ApiEndpointsService } from '../../api/api-endpoints';
import { LoadingSpinnerComponent } from '../../components/loading-spinner/loading-spinner';
import { withHttpCache } from '../../interceptors/http-cache.interceptor';
import {
  Item,
  ProductStockSummary,
  formatBestBeforeDate,
  getDaysUntilBestBeforeLabel,
  getNormalizedYukaScore,
  getYukaScoreView,
  toBestBeforeTime,
  toNumber
} from '../shared/product-shared';

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
  amountMissing: number;
}

@Component({
  selector: 'app-stock-volatile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoadingSpinnerComponent],
  templateUrl: './stock-volatile-page.html',
  styleUrl: './stock-volatile-page.scss'
})
export class StockVolatilePage {
  private readonly http = inject(HttpClient);
  private readonly apiEndpoints = inject(ApiEndpointsService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly localDateFormatter = new Intl.DateTimeFormat(navigator.language, {
    dateStyle: 'medium'
  });

  protected readonly isLoading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly section = signal<VolatileSection>('due');
  protected readonly volatileResponse = signal<VolatileStockResponse | null>(null);

  protected readonly pictureObjectUrls = signal<Record<string, string>>({});
  protected readonly pictureLoading = signal<Record<string, boolean>>({});
  protected readonly pictureFailed = signal<Record<string, boolean>>({});
  protected readonly previewImageUrl = signal<string | null>(null);
  protected readonly previewImageAlt = signal('');
  protected readonly previewPosition = signal<{ x: number; y: number }>({ x: 0, y: 0 });

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
      if (leftItem.amountMissing !== rightItem.amountMissing) {
        return rightItem.amountMissing - leftItem.amountMissing;
      }

      return leftItem.name.localeCompare(rightItem.name);
    });
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.clearPictureObjectUrls();
    });

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

  protected goBack(): void {
    this.router.navigate(['/']);
  }

  protected reloadItems(): void {
    this.loadVolatileStock();
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

  protected getYukaScoreView(item: VolatileViewItem) {
    return getYukaScoreView(item);
  }

  protected formatBestBeforeDate(bestBeforeDate: string | null): string | null {
    return formatBestBeforeDate(bestBeforeDate, this.localDateFormatter);
  }

  protected getDaysUntilBestBeforeLabel(bestBeforeDate: string | null): string | null {
    return getDaysUntilBestBeforeLabel(bestBeforeDate);
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
    }
  }

  protected onImagePointerLeave(event: PointerEvent): void {
    if (event.pointerType !== 'mouse') {
      return;
    }

    this.hideImagePreview();
  }

  private loadVolatileStock(): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.clearPictureObjectUrls();
    this.pictureLoading.set({});
    this.pictureFailed.set({});

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
          this.preloadProductPictures(this.items());
          this.isLoading.set(false);
        },
        error: () => {
          this.volatileResponse.set(null);
          this.errorMessage.set('Impossibile caricare i dati di stock volatile. Riprova.');
          this.isLoading.set(false);
        }
      });
  }

  private preloadProductPictures(items: VolatileViewItem[]): void {
    const pictureFileNames = new Set(
      items
        .map((item) => item.picture_file_name?.trim())
        .filter((fileName): fileName is string => Boolean(fileName))
    );

    const loadingState: Record<string, boolean> = {};
    for (const fileName of pictureFileNames) {
      loadingState[fileName] = true;
    }

    this.pictureLoading.set(loadingState);

    for (const fileName of pictureFileNames) {
      const pictureEndpoint = this.apiEndpoints.productPictureByBase64(this.encodeFileNameToBase64(fileName));

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
        amountMissing: 0
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

}
