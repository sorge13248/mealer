import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  Injector,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal
} from '@angular/core';
import { LucideCheck, LucideDynamicIcon, LucideExternalLink } from '@lucide/angular';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription } from 'rxjs';
import { ApiEndpointsService } from '../../api/api-endpoints';
import {
  Item,
  ProductStockSummary,
  formatBestBeforeDate,
  getDaysUntilBestBeforeLabel,
  getYukaScoreView
} from '../../pages/shared/product-shared';
import { withHttpCache } from '../../interceptors/http-cache.interceptor';
import { LoadingSpinnerComponent } from '../loading-spinner/loading-spinner';

type ItemCardItem = Item & {
  stockSummary?: ProductStockSummary | null;
  amountMissing?: number | null;
};

export interface ItemConsumedEvent {
  itemId: number;
  stockSummary: ProductStockSummary;
}

@Component({
  selector: 'app-item-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LoadingSpinnerComponent, LucideDynamicIcon],
  templateUrl: './item-card.html',
  styleUrl: './item-card.scss'
})
export class ItemCardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly apiEndpoints = inject(ApiEndpointsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly localDateFormatter = new Intl.DateTimeFormat(navigator.language, {
    dateStyle: 'medium'
  });
  private pictureLoadAttempt = 0;
  private currentPictureFileName: string | null = null;
  private currentPictureRequest: Subscription | null = null;
  private consumeFeedbackTimeoutId: ReturnType<typeof setTimeout> | null = null;

  readonly item = input.required<ItemCardItem>();
  readonly consumed = output<ItemConsumedEvent>();
  protected readonly pictureUrl = signal<string | null>(null);
  protected readonly isPictureLoading = signal(false);
  protected readonly didPictureFail = signal(false);
  protected readonly isConsuming = signal(false);
  protected readonly isConsumedRecently = signal(false);
  protected readonly consumeError = signal<string | null>(null);
  protected readonly stockSummaryOverride = signal<ProductStockSummary | null>(null);
  protected readonly checkIcon = LucideCheck;
  protected readonly openIcon = LucideExternalLink;

  protected readonly hasPicture = computed(() => Boolean(this.item().picture_file_name?.trim()));
  protected readonly grocyProductUrl = computed(() => this.apiEndpoints.productPage(this.item().id));
  protected readonly yukaScore = computed(() => getYukaScoreView(this.item()));
  protected readonly stockSummary = computed(() => this.stockSummaryOverride() ?? this.item().stockSummary ?? null);
  protected readonly amountMissing = computed(() => this.item().amountMissing ?? null);
  protected readonly canConsume = computed(() => {
    if (this.amountMissing() !== null) {
      return false;
    }

    const stockSummary = this.stockSummary();
    if (!stockSummary) {
      return false;
    }

    return stockSummary.amount > 0 || stockSummary.amountOpened > 0;
  });
  protected readonly formattedBestBeforeDate = computed(() => {
    const bestBeforeDate = this.stockSummary()?.nearestBestBeforeDate ?? null;
    return formatBestBeforeDate(bestBeforeDate, this.localDateFormatter);
  });
  protected readonly daysUntilBestBeforeLabel = computed(() => {
    const bestBeforeDate = this.stockSummary()?.nearestBestBeforeDate ?? null;
    return getDaysUntilBestBeforeLabel(bestBeforeDate);
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.currentPictureRequest?.unsubscribe();
      this.currentPictureRequest = null;
      if (this.consumeFeedbackTimeoutId !== null) {
        clearTimeout(this.consumeFeedbackTimeoutId);
      }
      this.clearPictureUrl();
    });
  }

  ngOnInit(): void {
    effect(() => {
      const pictureFileName = this.item().picture_file_name?.trim();
      this.loadPicture(pictureFileName);
    }, { injector: this.injector, allowSignalWrites: true });

    effect(() => {
      const itemId = this.item().id;
      void itemId;

      this.stockSummaryOverride.set(null);
      this.consumeError.set(null);
      this.isConsuming.set(false);
      this.isConsumedRecently.set(false);
    }, { injector: this.injector, allowSignalWrites: true });
  }

  protected consumeOne(): void {
    if (!this.canConsume() || this.isConsuming()) {
      return;
    }

    this.consumeError.set(null);
    this.isConsuming.set(true);

    this.http
      .post<void>(this.apiEndpoints.consumeProduct(this.item().id), { amount: 1 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.applyLocalConsume();
          const updatedStockSummary = this.stockSummary();
          if (updatedStockSummary) {
            this.consumed.emit({
              itemId: this.item().id,
              stockSummary: updatedStockSummary,
            });
          }

          this.isConsuming.set(false);
          this.isConsumedRecently.set(true);

          if (this.consumeFeedbackTimeoutId !== null) {
            clearTimeout(this.consumeFeedbackTimeoutId);
          }

          if (typeof window !== 'undefined') {
            this.consumeFeedbackTimeoutId = window.setTimeout(() => {
              this.isConsumedRecently.set(false);
            }, 1800);
          }
        },
        error: () => {
          this.isConsuming.set(false);
          this.consumeError.set('Impossibile consumare il prodotto. Riprova.');
        }
      });
  }

  private applyLocalConsume(): void {
    const currentStockSummary = this.stockSummary();
    if (!currentStockSummary) {
      return;
    }

    const nextAmountOpened =
      currentStockSummary.amountOpened > 0 ? currentStockSummary.amountOpened - 1 : currentStockSummary.amountOpened;
    const nextAmount =
      currentStockSummary.amountOpened > 0
        ? currentStockSummary.amount
        : Math.max(0, currentStockSummary.amount - 1);

    this.stockSummaryOverride.set({
      ...currentStockSummary,
      amount: Math.max(0, nextAmount),
      amountOpened: Math.max(0, nextAmountOpened),
    });
  }

  private loadPicture(fileName: string | undefined): void {
    const normalizedFileName = fileName?.trim() || null;

    if (normalizedFileName === this.currentPictureFileName) {
      return;
    }

    this.pictureLoadAttempt += 1;
    const loadAttempt = this.pictureLoadAttempt;
    this.currentPictureFileName = normalizedFileName;
    this.currentPictureRequest?.unsubscribe();
    this.currentPictureRequest = null;

    this.clearPictureUrl();
    this.isPictureLoading.set(false);
    this.didPictureFail.set(false);

    if (!normalizedFileName) {
      return;
    }

    this.isPictureLoading.set(true);
    const pictureEndpoint = this.apiEndpoints.productPictureByBase64(this.encodeFileNameToBase64(normalizedFileName));

    this.currentPictureRequest = this.http
      .get(pictureEndpoint, { responseType: 'blob', context: withHttpCache(true) })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (imageBlob) => {
          const objectUrl = URL.createObjectURL(imageBlob);

          if (loadAttempt !== this.pictureLoadAttempt) {
            URL.revokeObjectURL(objectUrl);
            return;
          }

          this.clearPictureUrl();
          this.pictureUrl.set(objectUrl);
          this.isPictureLoading.set(false);
          this.currentPictureRequest = null;
        },
        error: () => {
          if (loadAttempt !== this.pictureLoadAttempt) {
            return;
          }

          this.isPictureLoading.set(false);
          this.didPictureFail.set(true);
          this.currentPictureRequest = null;
        }
      });
  }

  private clearPictureUrl(): void {
    const currentPictureUrl = this.pictureUrl();
    if (currentPictureUrl) {
      URL.revokeObjectURL(currentPictureUrl);
    }

    this.pictureUrl.set(null);
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
