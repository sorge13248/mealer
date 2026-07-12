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

  productPictureByBase64(encodedFileName: string): string {
    return `${this.apiPrefix}/files/productpictures/${encodedFileName}`;
  }

  private get apiPrefix(): string {
    return `${this.runtimeSecrets.apiUrl}/api`;
  }
}
