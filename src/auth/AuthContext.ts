import { createContext, useContext } from 'react';
import type { Me, Permission } from '../api/types';

export type AuthState =
  | { status: 'restoring' }
  | { status: 'restore-failed'; message: string }
  | { status: 'anonymous'; notice: string | null }
  | { status: 'authenticated'; me: Me };

export interface AuthContextValue {
  state: AuthState;
  me: Me | null;
  can: (permission: Permission) => boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (teamName: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  retryRestore: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return value;
}
