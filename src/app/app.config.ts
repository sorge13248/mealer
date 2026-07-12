import { provideHttpClient, withInterceptors, withXhr } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { grocyApiKeyInterceptor } from './interceptors/grocy-api-key.interceptor';
import { httpCacheInterceptor } from './interceptors/http-cache.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withXhr(), withInterceptors([httpCacheInterceptor, grocyApiKeyInterceptor])),
    provideRouter(routes),
  ],
};
