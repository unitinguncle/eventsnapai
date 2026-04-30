import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import api from '../services/api';
import { registerForPushNotifications, savePushToken, clearPushToken } from '../services/notifications';

// ── Types ─────────────────────────────────────────────────────────────────────
export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: 'admin' | 'manager' | 'user';
  featureManualCompression: boolean;
  featureAlbum: boolean;
  featureCollabEvents: boolean;
}

export interface CollabMember {
  id: string;
  username: string;
  displayName: string;
  role: 'user';
  eventId: string;
  canUpload: boolean;
  eventName: string;
}

interface AuthContextType {
  user: AuthUser | null;
  member: CollabMember | null; // Non-null only for collab member sessions
  isLoading: boolean;
  isMaintenanceMode: boolean;
  login: (username: string, password: string) => Promise<AuthUser>;
  memberLogin: (username: string, password: string, eventId: string) => Promise<CollabMember>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

// ── Context ───────────────────────────────────────────────────────────────────
const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [member, setMember] = useState<CollabMember | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false);

  // ── Session restore on app launch ─────────────────────────────────────────
  useEffect(() => {
    restoreSession();
  }, []);

  const restoreSession = async () => {
    try {
      const token = await SecureStore.getItemAsync('auth_token');
      if (!token) { setIsLoading(false); return; }

      // Check for collab member session
      const memberJson = await SecureStore.getItemAsync('auth_member');
      if (memberJson) {
        setMember(JSON.parse(memberJson));
        setIsLoading(false);
        return;
      }

      // Verify regular user JWT is still valid + get fresh feature flags
      const { data } = await api.get('/auth/me');
      setUser(data);
    } catch (err: any) {
      // Token expired or server error — clear local state
      await clearStorage();
      if (err?.isMaintenanceMode) setIsMaintenanceMode(true);
    } finally {
      setIsLoading(false);
    }
  };

  const refreshUser = useCallback(async () => {
    try {
      const { data } = await api.get('/auth/me');
      setUser(data);
    } catch {}
  }, []);

  // ── Login (Manager / Client) ───────────────────────────────────────────────
  const login = async (username: string, password: string): Promise<AuthUser> => {
    const { data } = await api.post('/auth/login', { username, password });
    await SecureStore.setItemAsync('auth_token', data.token);
    await SecureStore.deleteItemAsync('auth_member');

    // Fetch full user profile with feature flags
    const { data: profile } = await api.get('/auth/me');
    setUser(profile);
    setMember(null);

    // Register push token (non-blocking — won't fail login if denied)
    registerForPushNotifications().then(token => {
      if (token) savePushToken(token);
    }).catch(() => {});

    return profile;
  };

  // ── Collab Member Login ───────────────────────────────────────────────────
  const memberLogin = async (
    username: string,
    password: string,
    eventId: string
  ): Promise<CollabMember> => {
    const { data } = await api.post('/auth/member-login', { username, password, eventId });
    await SecureStore.setItemAsync('auth_token', data.token);
    await SecureStore.setItemAsync('auth_member', JSON.stringify(data.member));
    setMember(data.member);
    setUser(null);
    return data.member;
  };

  // ── Logout ────────────────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    // Clear push token from server (non-blocking)
    clearPushToken().catch(() => {});
    await clearStorage();
    setUser(null);
    setMember(null);
  }, []); // stable — no state/prop deps needed

  const clearStorage = async () => {
    await SecureStore.deleteItemAsync('auth_token').catch(() => {});
    await SecureStore.deleteItemAsync('auth_member').catch(() => {});
    await SecureStore.deleteItemAsync('auth_user').catch(() => {});
  };

  return (
    <AuthContext.Provider
      value={{ user, member, isLoading, isMaintenanceMode, login, memberLogin, logout, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// ── Hook ──────────────────────────────────────────────────────────────────────
export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>');
  return ctx;
};
