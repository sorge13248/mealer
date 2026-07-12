import { environment } from '../../environments/environment';

const API_BASE_URL = environment.API_URL;
const API_PREFIX = `${API_BASE_URL}/api`;

export const API_ENDPOINTS = {
  products: `${API_PREFIX}/objects/products`,
  stock: `${API_PREFIX}/stock`,
  productPictureByBase64: (encodedFileName: string): string => `${API_PREFIX}/files/productpictures/${encodedFileName}`
} as const;
