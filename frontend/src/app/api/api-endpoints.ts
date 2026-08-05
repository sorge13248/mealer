import { Injectable, inject } from '@angular/core';
import { RuntimeConfigService } from '../services/runtime-config.service';

@Injectable({ providedIn: 'root' })
export class ApiEndpointsService {
  private readonly runtimeConfig = inject(RuntimeConfigService);

  products(): string {
    return `${this.apiPrefix}/products`;
  }

  stock(): string {
    return `${this.apiPrefix}/stock`;
  }

  stockVolatile(): string {
    return `${this.apiPrefix}/stock/volatile`;
  }

  consumeProduct(productId: number): string {
    return `${this.apiPrefix}/stock/products/${productId}/consume`;
  }

  productPictureByBase64(encodedFileName: string): string {
    return `${this.apiPrefix}/files/productpictures/${encodeURIComponent(encodedFileName)}`;
  }

  productPage(productId: number): string {
    return `${this.apiPrefix}/product/${productId}`;
  }

  grocyProductsPage(): string {
    return `${this.apiPrefix}/products-page`;
  }

  spesaReceiptParse(): string {
    return `${this.runtimeConfig.backendApiBaseUrl}/spesa/receipt/parse`;
  }

  spesaMatchCandidates(): string {
    return `${this.runtimeConfig.backendApiBaseUrl}/spesa/match/candidates`;
  }

  spesaMappings(): string {
    return `${this.runtimeConfig.backendApiBaseUrl}/spesa/mappings`;
  }

  spesaReceiptSave(): string {
    return `${this.runtimeConfig.backendApiBaseUrl}/spesa/receipt/save`;
  }

  spesaReceipts(page: number, pageSize: number): string {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    return `${this.runtimeConfig.backendApiBaseUrl}/spesa/receipts?${params.toString()}`;
  }

  spesaReceiptDetail(receiptId: number): string {
    return `${this.runtimeConfig.backendApiBaseUrl}/spesa/receipts/${receiptId}`;
  }

  spesaDeleteReceipt(receiptId: number): string {
    return `${this.runtimeConfig.backendApiBaseUrl}/spesa/receipts/${receiptId}`;
  }

  spesaInsights(days: number, productIds: number[]): string {
    const params = new URLSearchParams();
    params.set('days', String(days));
    if (productIds.length > 0) {
      params.set('productIds', productIds.join(','));
    }

    return `${this.runtimeConfig.backendApiBaseUrl}/spesa/insights?${params.toString()}`;
  }

  private get apiPrefix(): string {
    return `${this.runtimeConfig.backendApiBaseUrl}/grocy`;
  }
}
