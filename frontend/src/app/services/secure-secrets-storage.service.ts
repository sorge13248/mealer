import { Injectable } from '@angular/core';
import { RuntimeSecrets, sanitizeSecrets } from '../config/runtime-secrets';

interface StoredEncryptedPayload {
  version: 1;
  iv: number[];
  data: number[];
}

const DB_NAME = 'mealer-secure-storage';
const DB_VERSION = 1;
const STORE_NAME = 'secure-secrets';
const KEY_NAME = 'encryption-key';
const PAYLOAD_NAME = 'encrypted-secrets';

@Injectable({ providedIn: 'root' })
export class SecureSecretsStorageService {
  async loadSecrets(): Promise<RuntimeSecrets | null> {
    if (!this.isWebCryptoAvailable()) {
      return null;
    }

    const [cryptoKey, encryptedPayload] = await Promise.all([
      this.readValue<CryptoKey>(KEY_NAME),
      this.readValue<StoredEncryptedPayload>(PAYLOAD_NAME)
    ]);

    if (!cryptoKey || !encryptedPayload) {
      return null;
    }

    try {
      const decryptedBuffer = await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(encryptedPayload.iv)
        },
        cryptoKey,
        new Uint8Array(encryptedPayload.data)
      );

      const decodedJson = new TextDecoder().decode(decryptedBuffer);
      const parsedPayload = JSON.parse(decodedJson) as Partial<RuntimeSecrets>;

      return sanitizeSecrets(parsedPayload);
    } catch {
      await this.clearSecrets();
      return null;
    }
  }

  async saveSecrets(secrets: RuntimeSecrets): Promise<void> {
    if (!this.isWebCryptoAvailable()) {
      throw new Error('Web Crypto non disponibile in questo browser.');
    }

    const sanitizedSecrets = sanitizeSecrets(secrets);
    if (!sanitizedSecrets) {
      throw new Error('Config non valida.');
    }

    const cryptoKey = await this.getOrCreateKey();

    const plaintext = JSON.stringify(sanitizedSecrets);
    const encodedPlaintext = new TextEncoder().encode(plaintext);
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const encryptedBuffer = await crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv
      },
      cryptoKey,
      encodedPlaintext
    );

    const encryptedPayload: StoredEncryptedPayload = {
      version: 1,
      iv: Array.from(iv),
      data: Array.from(new Uint8Array(encryptedBuffer))
    };

    await this.writeValue(PAYLOAD_NAME, encryptedPayload);
  }

  async clearSecrets(): Promise<void> {
    await Promise.all([this.deleteValue(KEY_NAME), this.deleteValue(PAYLOAD_NAME)]);
  }

  private isWebCryptoAvailable(): boolean {
    return typeof window !== 'undefined' && typeof window.crypto?.subtle !== 'undefined';
  }

  private async getOrCreateKey(): Promise<CryptoKey> {
    const existingKey = await this.readValue<CryptoKey>(KEY_NAME);
    if (existingKey) {
      return existingKey;
    }

    const generatedKey = await crypto.subtle.generateKey(
      {
        name: 'AES-GCM',
        length: 256
      },
      false,
      ['encrypt', 'decrypt']
    );

    await this.writeValue(KEY_NAME, generatedKey);
    return generatedKey;
  }

  private async openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const openRequest = indexedDB.open(DB_NAME, DB_VERSION);

      openRequest.onupgradeneeded = () => {
        const database = openRequest.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME);
        }
      };

      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => reject(openRequest.error);
    });
  }

  private async readValue<T>(key: string): Promise<T | null> {
    const database = await this.openDatabase();

    try {
      return await new Promise<T | null>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readonly');
        const objectStore = transaction.objectStore(STORE_NAME);
        const request = objectStore.get(key);

        request.onsuccess = () => {
          resolve((request.result as T | undefined) ?? null);
        };

        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }

  private async writeValue<T>(key: string, value: T): Promise<void> {
    const database = await this.openDatabase();

    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const objectStore = transaction.objectStore(STORE_NAME);
        objectStore.put(value, key);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  private async deleteValue(key: string): Promise<void> {
    const database = await this.openDatabase();

    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, 'readwrite');
        const objectStore = transaction.objectStore(STORE_NAME);
        objectStore.delete(key);

        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }
}
