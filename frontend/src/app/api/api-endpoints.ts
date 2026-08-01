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

  private get apiPrefix(): string {
    const normalizedBackendBaseUrl = environment.backendApiBaseUrl.replace(/\/+$/, '');
    return `${normalizedBackendBaseUrl}/grocy`;
  }
}
