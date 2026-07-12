import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { App } from './app';
import { SecureSecretsStorageService } from './services/secure-secrets-storage.service';

class SecureSecretsStorageServiceMock {
  loadSecrets(): Promise<null> {
    return Promise.resolve(null);
  }

  saveSecrets(): Promise<void> {
    return Promise.resolve();
  }

  clearSecrets(): Promise<void> {
    return Promise.resolve();
  }
}

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideHttpClient(),
        provideRouter([]),
        {
          provide: SecureSecretsStorageService,
          useClass: SecureSecretsStorageServiceMock
        }
      ]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render setup form on first access', async () => {
    const fixture = TestBed.createComponent(App);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('form')).toBeTruthy();
  });
});
