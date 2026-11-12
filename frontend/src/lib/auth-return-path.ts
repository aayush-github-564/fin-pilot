const returnPathKey = "finpilot.auth.returnPath";

export function getSafeReturnPath(value: string | null | undefined): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (["/login", "/register", "/verify-email", "/forgot-password", "/reset-password"].some(
    (path) => value === path || value.startsWith(`${path}?`),
  )) return null;
  return value;
}

export function rememberReturnPath(value: string | null | undefined): void {
  const safePath = getSafeReturnPath(value);
  if (safePath) window.sessionStorage.setItem(returnPathKey, safePath);
}

export function takeReturnPath(): string {
  const path = getSafeReturnPath(window.sessionStorage.getItem(returnPathKey));
  window.sessionStorage.removeItem(returnPathKey);
  return path ?? "/companies";
}
