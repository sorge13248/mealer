import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

interface RuntimeConfigPayload {
  backendApiBaseUrl?: unknown;
}

@Injectable({ providedIn: 'root' })
export class RuntimeConfigService {
  private readonly backendApiBaseUrlState = signal(
    normalizeBackendApiBaseUrl(environment.backendApiBaseUrl)
  );

  get backendApiBaseUrl(): string {
    return this.backendApiBaseUrlState();
  }

  async load(): Promise<void> {
    try {
      const response = await fetch('/config.json', { cache: 'no-store' });

      if (!response.ok) {
        if (response.status !== 404) {
          console.warn(`Impossibile caricare /config.json (status ${response.status}). Uso i default.`);
        }
        return;
      }

      const payload = (await response.json()) as RuntimeConfigPayload;
      const backendApiBaseUrl = normalizeBackendApiBaseUrl(
        typeof payload.backendApiBaseUrl === 'string' ? payload.backendApiBaseUrl : ''
      );

      if (backendApiBaseUrl) {
        this.backendApiBaseUrlState.set(backendApiBaseUrl);
      }
    } catch (error) {
      console.warn('Errore nel caricamento di /config.json. Uso i default.', error);
    }
  }
}

function normalizeBackendApiBaseUrl(value: string): string {
  const normalizedValue = value.trim().replace(/\/+$/, '');
  return normalizedValue || environment.backendApiBaseUrl;
}
