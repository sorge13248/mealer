import { Injectable, computed, signal } from '@angular/core';
import { RuntimeSecrets, sanitizeSecrets } from '../config/runtime-secrets';

@Injectable({ providedIn: 'root' })
export class RuntimeSecretsService {
  private readonly secretsState = signal<RuntimeSecrets | null>(null);

  readonly secrets = computed(() => this.secretsState());
  readonly isReady = computed(() => this.secretsState() !== null);

  setSecrets(secrets: RuntimeSecrets): void {
    this.secretsState.set(sanitizeSecrets(secrets));
  }

  clearSecrets(): void {
    this.secretsState.set(null);
  }

  get apiUrl(): string {
    return this.secretsState()?.apiUrl ?? '';
  }

  get apiKey(): string {
    return this.secretsState()?.apiKey ?? '';
  }
}
