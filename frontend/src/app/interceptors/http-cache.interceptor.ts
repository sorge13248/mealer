import {
  HttpContext,
  HttpContextToken,
  HttpEvent,
  HttpInterceptorFn,
  HttpRequest,
  HttpResponse
} from '@angular/common/http';
import { Observable, of, tap } from 'rxjs';

export const HTTP_CACHE_ENABLED = new HttpContextToken<boolean>(() => false);

const responseCache = new Map<string, HttpResponse<unknown>>();

export function withHttpCache(enabled = true): HttpContext {
  // Opt-in switch per request to avoid accidental caching of mutable endpoints.
  return new HttpContext().set(HTTP_CACHE_ENABLED, enabled);
}

export const httpCacheInterceptor: HttpInterceptorFn = (request, next): Observable<HttpEvent<unknown>> => {
  if (!request.context.get(HTTP_CACHE_ENABLED)) {
    return next(request);
  }

  const cacheKey = buildCacheKey(request);
  // Clone cached responses to keep HttpResponse immutability guarantees for callers.
  const cachedResponse = responseCache.get(cacheKey);
  if (cachedResponse) {
    return of(cachedResponse.clone());
  }

  return next(request).pipe(
    tap((event) => {
      if (event instanceof HttpResponse) {
        responseCache.set(cacheKey, event.clone());
      }
    })
  );
};

function buildCacheKey(request: HttpRequest<unknown>): string {
  // Include method + URL + stable body snapshot to avoid key collisions.
  return [
    request.method,
    request.urlWithParams,
    stableSerialize(request.body)
  ].join('::');
}

function stableSerialize(value: unknown): string {
  // Stable object-key ordering ensures logically equal payloads hash to same cache key.
  if (value === undefined) {
    return 'undefined';
  }

  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableSerialize(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const objectValue = value as Record<string, unknown>;
    const sortedKeys = Object.keys(objectValue).sort();
    return `{${sortedKeys
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(objectValue[key])}`)
      .join(',')}}`;
  }

  return JSON.stringify(String(value));
}
