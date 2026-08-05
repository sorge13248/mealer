import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { AxiosError } from 'axios';
import { createGrocyApiKeyInterceptor } from './interceptors/grocy-api-key.interceptor';
import { GrocyConfig, readGrocyConfigFromEnv } from './grocy.config';

interface GrocyPictureResponse {
  data: Buffer;
  contentType?: string;
  contentLength?: string;
  cacheControl?: string;
}

@Injectable()
export class GrocyService {
  constructor(private readonly httpService: HttpService) {
    // Inject API key on every outbound request so callers never handle secrets directly.
    this.httpService.axiosRef.interceptors.request.use(
      createGrocyApiKeyInterceptor(() => this.readConfig().apiKey),
    );
  }

  async getProducts(): Promise<unknown> {
    return this.get('api/objects/products');
  }

  async getStock(): Promise<unknown> {
    return this.get('api/stock');
  }

  async getVolatileStock(): Promise<unknown> {
    return this.get('api/stock/volatile');
  }

  async consumeProduct(productId: number, payload: unknown): Promise<unknown> {
    return this.post(`api/stock/products/${productId}/consume`, payload);
  }

  async getProductPictureByEncodedName(
    encodedFileName: string,
  ): Promise<GrocyPictureResponse> {
    // Product pictures use encoded names in Grocy paths; normalize URL-safe base64 first.
    const normalizedToken = this.normalizeBase64Token(encodedFileName);

    try {
      const config = this.readConfig();
      const response = await this.httpService.axiosRef.get<ArrayBuffer>(
        `api/files/productpictures/${encodeURIComponent(normalizedToken)}`,
        {
          baseURL: config.baseUrl,
          timeout: config.timeoutMs,
          responseType: 'arraybuffer',
        },
      );

      return {
        data: Buffer.from(response.data),
        contentType: this.headerValueToString(response.headers['content-type']),
        contentLength: this.headerValueToString(
          response.headers['content-length'],
        ),
        cacheControl: this.headerValueToString(
          response.headers['cache-control'],
        ),
      };
    } catch (error) {
      this.throwAsHttpException(error);
    }
  }

  getProductPageUrl(productId: number): string {
    const config = this.readConfig();
    return `${config.baseUrl}/product/${productId}`;
  }

  getProductsPageUrl(): string {
    const config = this.readConfig();
    return `${config.baseUrl}/products`;
  }

  private async get(path: string): Promise<unknown> {
    // Thin proxy wrapper to centralize timeout/base URL/error mapping.
    try {
      const config = this.readConfig();
      const response = await this.httpService.axiosRef.get(path, {
        baseURL: config.baseUrl,
        timeout: config.timeoutMs,
      });
      return response.data;
    } catch (error) {
      this.throwAsHttpException(error);
    }
  }

  private async post(path: string, body: unknown): Promise<unknown> {
    try {
      const config = this.readConfig();
      const response = await this.httpService.axiosRef.post(path, body, {
        baseURL: config.baseUrl,
        timeout: config.timeoutMs,
      });
      return response.data;
    } catch (error) {
      this.throwAsHttpException(error);
    }
  }

  private decodeBase64ToUtf8(rawEncodedValue: string): string {
    const normalizedToken = this.normalizeBase64Token(rawEncodedValue);

    try {
      return Buffer.from(normalizedToken, 'base64').toString('utf-8');
    } catch {
      throw new BadRequestException('Invalid encoded file name');
    }
  }

  private normalizeBase64Token(rawEncodedValue: string): string {
    // Accept URL-safe base64 and pad to canonical length for decode/stable URLs.
    const trimmedValue = rawEncodedValue.trim();
    if (!trimmedValue) {
      throw new BadRequestException('Invalid encoded file name');
    }

    const normalized = trimmedValue.replace(/-/g, '+').replace(/_/g, '/');
    if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
      throw new BadRequestException('Invalid encoded file name');
    }

    const missingPadding = normalized.length % 4;
    return missingPadding === 0
      ? normalized
      : `${normalized}${'='.repeat(4 - missingPadding)}`;
  }

  private throwAsHttpException(error: unknown): never {
    // Preserve Grocy response payload/status while translating transport failures.
    if (error instanceof AxiosError) {
      const statusCode = error.response?.status ?? HttpStatus.BAD_GATEWAY;
      const responseData: unknown = error.response?.data;

      throw new HttpException(
        {
          message: 'Grocy request failed',
          statusCode,
          grocy: responseData ?? null,
        },
        statusCode,
      );
    }

    throw new HttpException('Grocy request failed', HttpStatus.BAD_GATEWAY);
  }

  private headerValueToString(value: unknown): string | undefined {
    if (typeof value === 'string') {
      return value;
    }

    if (Array.isArray(value)) {
      return value
        .map((entry) => {
          if (typeof entry === 'string') {
            return entry;
          }

          if (typeof entry === 'number' || typeof entry === 'boolean') {
            return String(entry);
          }

          return '';
        })
        .filter(Boolean)
        .join(',');
    }

    if (value === null || value === undefined) {
      return undefined;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
      return String(value);
    }

    if (typeof value === 'bigint') {
      return value.toString();
    }

    return undefined;
  }

  private readConfig(): GrocyConfig {
    return readGrocyConfigFromEnv();
  }
}
