import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  clearAccessToken,
  getAccessToken,
  setAccessToken,
  subscribeToAccessToken,
} from "../lib/auth-token";
import { queryClient } from "./query-client";

interface AuthContextValue {
  token: string | null;
  isAuthenticated: boolean;
  saveToken: (token: string) => void;
  signOut: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const token = useSyncExternalStore(
    subscribeToAccessToken,
    getAccessToken,
    getAccessToken,
  );
  const navigate = useNavigate();
  const location = useLocation();

  const saveToken = useCallback((nextToken: string) => {
    setAccessToken(nextToken);
  }, []);

  const signOut = useCallback(() => {
    clearAccessToken();
    queryClient.clear();
    navigate("/login", { replace: true });
  }, [navigate]);

  useEffect(() => {
    function handleUnauthorized() {
      const returnTo = `${location.pathname}${location.search}${location.hash}`;
      clearAccessToken();
      queryClient.clear();
      if (location.pathname !== "/login") {
        navigate(`/login?next=${encodeURIComponent(returnTo)}`, { replace: true });
      }
    }

    window.addEventListener("finpilot:unauthorized", handleUnauthorized);
    return () =>
      window.removeEventListener("finpilot:unauthorized", handleUnauthorized);
  }, [location.hash, location.pathname, location.search, navigate]);

  const value = useMemo(
    () => ({ token, isAuthenticated: token !== null, saveToken, signOut }),
    [token, saveToken, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider.");
  return context;
}
