export function setAuthSession(accessToken: string) {
  window.sessionStorage.setItem("test.supabase.accessToken", accessToken);
}
