import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "../../components/ui/button";
import { ErrorMessage } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { getSafeReturnPath } from "../../lib/auth-return-path";
import { supabase } from "../../lib/supabase";
import { AuthLayout } from "./auth-layout";
import { updatePassword, verifyRecoveryCode } from "./supabase-auth";

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const email = searchParams.get("email") ?? "";
  const next = getSafeReturnPath(searchParams.get("next"));
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (password.length < 10) return setError("Use at least 10 characters for your password.");
    if (password !== confirmPassword) return setError("Passwords do not match.");
    setBusy(true);
    const verified = await verifyRecoveryCode(email, code);
    if (verified.error) {
      setBusy(false);
      const expired = `${verified.error.code ?? ""} ${verified.error.message}`.toLowerCase().includes("expired");
      setError(expired ? "That recovery code has expired. Request a new one." : "That recovery code did not match. Check it and try again.");
      return;
    }
    const updated = await updatePassword(password);
    setBusy(false);
    if (updated.error) {
      setError("We could not update your password. Try again with a new recovery code.");
      return;
    }
    await supabase.auth.signOut();
    setComplete(true);
  }

  if (complete) {
    return (
      <AuthLayout eyebrow="Password updated" title="You’re all set" subtitle="Sign in with your new password to continue." footer={<Link className="font-semibold text-accent underline underline-offset-4" to={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Return to sign in</Link>}>
        <Button className="w-full" onClick={() => navigate(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`, { replace: true })} size="lg">Sign in</Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout eyebrow="Account recovery" title="Choose a new password" subtitle={`Enter the recovery code sent to ${email || "your email"}.`} footer={<Link className="font-semibold text-accent underline underline-offset-4" to={`/forgot-password${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Request another code</Link>}>
      <form className="space-y-5" noValidate onSubmit={(event) => void submit(event)}>
        {error && <ErrorMessage>{error}</ErrorMessage>}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground-body" htmlFor="recovery-code">Six-digit recovery code</label>
          <Input autoComplete="one-time-code" id="recovery-code" inputMode="numeric" maxLength={6} onChange={(event) => setCode(event.currentTarget.value.replace(/\D/g, "").slice(0, 6))} value={code} />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground-body" htmlFor="new-password">New password</label>
          <div className="relative">
            <Input autoComplete="new-password" className="pr-12" id="new-password" onChange={(event) => setPassword(event.currentTarget.value)} type={showPassword ? "text" : "password"} value={password} />
            <button aria-label={showPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-2 grid w-9 place-items-center text-muted" onClick={() => setShowPassword((value) => !value)} type="button">
              {showPassword ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
            </button>
          </div>
          <p className="text-xs text-muted">Use at least 10 characters.</p>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground-body" htmlFor="confirm-new-password">Confirm new password</label>
          <Input autoComplete="new-password" id="confirm-new-password" onChange={(event) => setConfirmPassword(event.currentTarget.value)} type={showPassword ? "text" : "password"} value={confirmPassword} />
        </div>
        <Button className="w-full" disabled={busy || code.length !== 6} size="lg" type="submit">
          {busy && <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />}
          {busy ? "Updating password" : "Update password"}
        </Button>
      </form>
    </AuthLayout>
  );
}
