import { supabase } from "../../lib/supabase";

export function signInWithEmail(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export function signUpWithEmail(fullName: string, email: string, password: string) {
  return supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${window.location.origin}/verify-email`,
    },
  });
}

export function verifyEmailCode(email: string, token: string) {
  return supabase.auth.verifyOtp({ email, token, type: "email" });
}

export function resendSignupCode(email: string) {
  return supabase.auth.resend({ type: "signup", email });
}

export function sendRecoveryCode(email: string) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/reset-password?email=${encodeURIComponent(email)}`,
  });
}

export function verifyRecoveryCode(email: string, token: string) {
  return supabase.auth.verifyOtp({ email, token, type: "recovery" });
}

export function updatePassword(password: string) {
  return supabase.auth.updateUser({ password });
}

export function signInWithGoogle(redirectTo: string) {
  return supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
}
