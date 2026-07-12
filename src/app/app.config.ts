import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { grocyApiKeyInterceptor } from './interceptors/grocy-api-key.interceptor';
import { httpCacheInterceptor } from './interceptors/http-cache.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([httpCacheInterceptor, grocyApiKeyInterceptor])),
    provideRouter(routes)
  ]
};
