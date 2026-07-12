import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../environments/environment';

export const grocyApiKeyInterceptor: HttpInterceptorFn = (request, next) => {
  const clonedRequest = request.clone({
    setHeaders: {
      'GROCY-API-KEY': environment.API_KEY
    }
  });

  return next(clonedRequest);
};
