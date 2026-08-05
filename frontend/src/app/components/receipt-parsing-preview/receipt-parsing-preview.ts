import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export interface ReceiptParsingPreviewItem {
  name: string;
  rawName?: string;
  quantity: number;
  unitPrice: number;
  discountTotal: number;
  totalPrice?: number;
  lineTotalDiscounted?: number;
}

export interface ReceiptParsingPreviewModel {
  source: 'pdf' | 'ocr';
  items: ReceiptParsingPreviewItem[];
  subtotal: number | null;
  total: number | null;
}

@Component({
  selector: 'app-receipt-parsing-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './receipt-parsing-preview.html',
  styleUrl: './receipt-parsing-preview.scss',
})
export class ReceiptParsingPreviewComponent {
  readonly title = input<string>('Anteprima parsing');
  readonly preview = input.required<ReceiptParsingPreviewModel>();

  protected formatMoney(value: number | null): string {
    if (value === null || !Number.isFinite(value)) {
      return '-';
    }

    return new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  protected toDiscountedLineTotal(item: ReceiptParsingPreviewItem): number {
    if (typeof item.lineTotalDiscounted === 'number' && Number.isFinite(item.lineTotalDiscounted)) {
      return item.lineTotalDiscounted;
    }

    const baseTotal = typeof item.totalPrice === 'number' && Number.isFinite(item.totalPrice)
      ? item.totalPrice
      : item.unitPrice * item.quantity;

    return Math.max(0, baseTotal - item.discountTotal);
  }
}
