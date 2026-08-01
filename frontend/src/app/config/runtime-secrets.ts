export interface RuntimeSecrets {
  apiUrl: string;
  apiKey: string;
}

export function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.trim().replace(/\/+$/, '');
}

export function sanitizeSecrets(value: Partial<RuntimeSecrets> | null | undefined): RuntimeSecrets | null {
  const apiUrl = normalizeApiUrl(value?.apiUrl ?? '');
  const apiKey = (value?.apiKey ?? '').trim();

  if (!apiUrl || !apiKey) {
    return null;
  }

  return { apiUrl, apiKey };
}
