import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterOutlet } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { RuntimeSecrets, normalizeApiUrl } from '../../config/runtime-secrets';
import { RuntimeSecretsService } from '../../services/runtime-secrets.service';
import { SecureSecretsStorageService } from '../../services/secure-secrets-storage.service';
import { LoadingSpinnerComponent } from '../loading-spinner/loading-spinner';

const ONBOARDING_VERSION_KEY = 'mealer-onboarding-completed-v1';

@Component({
  selector: 'app-onboarding-gate',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ReactiveFormsModule, LoadingSpinnerComponent],
  templateUrl: './onboarding-gate.html',
  styleUrl: './onboarding-gate.scss'
})
export class OnboardingGateComponent {
  private readonly http = inject(HttpClient);
  private readonly runtimeSecrets = inject(RuntimeSecretsService);
  private readonly secureSecretsStorage = inject(SecureSecretsStorageService);

  protected readonly isInitializing = signal(true);
  protected readonly isConfigured = signal(false);
  protected readonly isSaving = signal(false);
  protected readonly setupError = signal<string | null>(null);

  protected readonly setupForm = new FormGroup({
    apiUrl: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required]
    }),
    apiKey: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required]
    })
  });

  constructor() {
    void this.initializeSecrets();
  }

  protected async saveSecrets(): Promise<void> {
    this.setupForm.markAllAsTouched();
    if (this.setupForm.invalid) {
      return;
    }

    this.isSaving.set(true);
    this.setupError.set(null);

    const secrets: RuntimeSecrets = {
      apiUrl: normalizeApiUrl(this.setupForm.controls.apiUrl.value),
      apiKey: this.setupForm.controls.apiKey.value.trim()
    };

    try {
      const isValid = await this.validateSecrets(secrets);
      if (!isValid) {
        this.setupError.set('Configurazione non valida. Controlla URL e API key e riprova.');
        return;
      }

      await this.secureSecretsStorage.saveSecrets(secrets);
      this.runtimeSecrets.setSecrets(secrets);
      this.isConfigured.set(true);
      localStorage.setItem(ONBOARDING_VERSION_KEY, '1');
      this.setupForm.controls.apiKey.reset('');
    } catch {
      this.setupError.set('Impossibile salvare i secret nel browser. Verifica i dati e riprova.');
    } finally {
      this.isSaving.set(false);
    }
  }

  private async initializeSecrets(): Promise<void> {
    this.isInitializing.set(true);
    this.setupError.set(null);

    try {
      const storedSecrets = await this.secureSecretsStorage.loadSecrets();
      const isOnboardingCompleted = localStorage.getItem(ONBOARDING_VERSION_KEY) === '1';

      if (!storedSecrets || !isOnboardingCompleted) {
        this.isConfigured.set(false);
        if (storedSecrets) {
          this.setupForm.controls.apiUrl.setValue(storedSecrets.apiUrl);
        }
        return;
      }

      this.runtimeSecrets.setSecrets(storedSecrets);
      this.isConfigured.set(true);
      this.setupForm.controls.apiUrl.setValue(storedSecrets.apiUrl);
      this.setupForm.controls.apiKey.reset('');
    } catch {
      this.isConfigured.set(false);
      this.setupError.set('Impossibile leggere i secret salvati. Inseriscili di nuovo.');
    } finally {
      this.isInitializing.set(false);
    }
  }

  private async validateSecrets(secrets: RuntimeSecrets): Promise<boolean> {
    if (!secrets.apiUrl || !secrets.apiKey) {
      return false;
    }

    let systemInfoEndpoint: string;
    try {
      const baseUrl = new URL(secrets.apiUrl);
      systemInfoEndpoint = `${baseUrl.origin}${baseUrl.pathname.replace(/\/$/, '')}/api/system/info`;
    } catch {
      return false;
    }

    try {
      const response = await firstValueFrom(
        this.http.get(systemInfoEndpoint, {
          observe: 'response',
          headers: new HttpHeaders({
            'GROCY-API-KEY': secrets.apiKey
          })
        })
      );

      return response.status === 200;
    } catch {
      return false;
    }
  }
}
