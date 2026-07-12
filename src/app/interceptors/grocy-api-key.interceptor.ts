import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { RuntimeSecretsService } from '../services/runtime-secrets.service';

export const grocyApiKeyInterceptor: HttpInterceptorFn = (request, next) => {
  const runtimeSecrets = inject(RuntimeSecretsService);
  const apiKey = runtimeSecrets.apiKey;

  if (!apiKey) {
    return next(request);
  }

  const clonedRequest = request.clone({
    setHeaders: {
      'GROCY-API-KEY': apiKey
    }
  });

  return next(clonedRequest);
};
