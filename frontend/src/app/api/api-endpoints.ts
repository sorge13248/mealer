import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiEndpointsService {
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

  grocyNewProductPage(): string {
    return `${this.apiPrefix}/product-new-page`;
  }

  grocyObject(entity: string, objectId: number): string {
    return `${this.apiPrefix}/objects/${encodeURIComponent(entity)}/${objectId}`;
  }

  grocyObjectUserfields(entity: string, objectId: number): string {
    return `${this.apiPrefix}/userfields/${encodeURIComponent(entity)}/${objectId}`;
  }

  spesaReceiptParse(): string {
    return `${environment.backendApiBaseUrl}/spesa/receipt/parse`;
  }

  spesaMatchCandidates(): string {
    return `${environment.backendApiBaseUrl}/spesa/match/candidates`;
  }

  spesaMappings(): string {
    return `${environment.backendApiBaseUrl}/spesa/mappings`;
  }

  spesaReceiptSave(): string {
    return `${environment.backendApiBaseUrl}/spesa/receipt/save`;
  }

  spesaReceipts(page: number, pageSize: number): string {
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    return `${environment.backendApiBaseUrl}/spesa/receipts?${params.toString()}`;
  }

  spesaReceiptDetail(receiptId: number): string {
    return `${environment.backendApiBaseUrl}/spesa/receipts/${receiptId}`;
  }

  spesaDeleteReceipt(receiptId: number): string {
    return `${environment.backendApiBaseUrl}/spesa/receipts/${receiptId}`;
  }

  spesaInsights(days: number, productIds: number[]): string {
    const params = new URLSearchParams();
    params.set('days', String(days));
    if (productIds.length > 0) {
      params.set('productIds', productIds.join(','));
    }

    return `${environment.backendApiBaseUrl}/spesa/insights?${params.toString()}`;
  }

  private get apiPrefix(): string {
    return `${environment.backendApiBaseUrl}/grocy`;
  }
}
