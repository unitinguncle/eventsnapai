import axios from 'axios';
import * as SecureStore from 'expo-secure-store';

// ── Base configuration ────────────────────────────────────────────────────────
export const API_BASE_URL = 'https://delivery.raidcloud.in';

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000, // 30s — upload batches can take time on slow connections
  headers: {
    'Content-Type': 'application/json',
  },
});

// ── Request interceptor — attach JWT on every request ─────────────────────────
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // SecureStore failure — proceed without token
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// ── Response interceptor — handle auth errors centrally ───────────────────────
api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const status = error.response?.status;
    const errorCode = error.response?.data?.error;

    if (status === 401 || (status === 403 && errorCode === 'ACCESS_REVOKED')) {
      // Clear local auth state — session expired or account deactivated
      await SecureStore.deleteItemAsync('auth_token').catch(() => {});
      await SecureStore.deleteItemAsync('auth_user').catch(() => {});
      // The AuthContext will detect missing token on next /auth/me check
      // and redirect to login. Import navigationRef if direct navigation needed.
    }

    if (status === 503 && errorCode === 'MAINTENANCE_MODE') {
      // Signal maintenance mode to the app
      error.isMaintenanceMode = true;
    }

    return Promise.reject(error);
  }
);

export default api;
