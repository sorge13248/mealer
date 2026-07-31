import { Injectable, inject } from '@angular/core';
import { RuntimeSecretsService } from '../services/runtime-secrets.service';

@Injectable({ providedIn: 'root' })
export class ApiEndpointsService {
  private readonly runtimeSecrets = inject(RuntimeSecretsService);

  products(): string {
    return `${this.apiPrefix}/objects/products`;
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
    return `${this.apiPrefix}/files/productpictures/${encodedFileName}`;
  }

  productPage(productId: number): string {
    return `${this.runtimeSecrets.apiUrl}/product/${productId}`;
  }

  private get apiPrefix(): string {
    return `${this.runtimeSecrets.apiUrl}/api`;
  }
}
