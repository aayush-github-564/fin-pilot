const tokenStorageKey = "finpilot.accessToken";
const subscribers = new Set<() => void>();

let accessToken = readStoredToken();

function readStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(tokenStorageKey);
}

function notifySubscribers(): void {
  for (const subscriber of subscribers) subscriber();
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function subscribeToAccessToken(subscriber: () => void): () => void {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
}

export function setAccessToken(token: string): void {
  accessToken = token;
  window.sessionStorage.setItem(tokenStorageKey, token);
  notifySubscribers();
}

export function clearAccessToken(): void {
  accessToken = null;
  if (typeof window !== "undefined") {
    window.sessionStorage.removeItem(tokenStorageKey);
  }
  notifySubscribers();
}
