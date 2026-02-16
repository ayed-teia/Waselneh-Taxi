import { create } from 'zustand';
import type { User } from 'firebase/auth';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: false,
  setUser: (user) =>
    set({
      user,
      isAuthenticated: user !== null,
      isLoading: false,
    }),
  setLoading: (isLoading) => set({ isLoading }),
}));
