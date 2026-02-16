import { useEffect, createContext, useContext, type ReactNode } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { createUserDoc } from '@/lib/firestore';
import { useAppDispatch, useAppSelector } from '@/store';
import { setUser, setLoading } from '@/store/slices/authSlice';
import { getCachedUser, setCachedUser, clearCache } from '@/lib/cache';

const AuthContext = createContext<null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();

  useEffect(() => {
    // Hydrate from localStorage immediately — avoids loading flash
    const cached = getCachedUser();
    if (cached) {
      dispatch(setUser(cached));
    } else {
      dispatch(setLoading(true));
    }

    // Then listen for the real Firebase auth state
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const user = {
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
        };
        dispatch(setUser(user));
        setCachedUser(user);
        // Upsert user doc (lastLoginAt)
        try {
          await createUserDoc(firebaseUser.uid, firebaseUser.email, firebaseUser.displayName);
        } catch (err) {
          console.error('Failed to upsert user doc:', err);
        }
      } else {
        dispatch(setUser(null));
        setCachedUser(null);
        clearCache();
      }
    });

    return unsubscribe;
  }, [dispatch]);

  return (
    <AuthContext.Provider value={null}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  useContext(AuthContext);
  const user = useAppSelector((s) => s.auth.user);
  const loading = useAppSelector((s) => s.auth.loading);
  const error = useAppSelector((s) => s.auth.error);
  return { user, loading, error };
}
