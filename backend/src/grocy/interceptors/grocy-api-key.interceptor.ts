import { AxiosHeaders, InternalAxiosRequestConfig } from 'axios';

export function createGrocyApiKeyInterceptor(getApiKey: () => string) {
  return (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
    const headers = AxiosHeaders.from(config.headers);
    headers.set('GROCY-API-KEY', getApiKey());
    config.headers = headers;
    return config;
  };
}
