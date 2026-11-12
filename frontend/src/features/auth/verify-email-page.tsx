import { ArrowRight, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "../../components/ui/button";
import { ErrorMessage } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { getSafeReturnPath, takeReturnPath } from "../../lib/auth-return-path";
import { AuthLayout } from "./auth-layout";
import { resendSignupCode, verifyEmailCode } from "./supabase-auth";

export function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const email = searchParams.get("email") ?? "";
  const next = getSafeReturnPath((location.state as { next?: string } | null)?.next);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [resendError, setResendError] = useState(false);
  const [cooldown, setCooldown] = useState(60);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timeout = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timeout);
  }, [cooldown]);

  async function submitCode(value: string) {
    if (value.length !== 6 || submitting) return;
    setSubmitting(true);
    setError("");
    const { error: verifyError } = await verifyEmailCode(email, value);
    setSubmitting(false);
    if (verifyError) {
      const isExpired = `${verifyError.code ?? ""} ${verifyError.message}`.toLowerCase().includes("expired");
      setError(isExpired ? "That code has expired. Request a new one." : "That code did not match. Check it and try again.");
      return;
    }
    const rememberedPath = takeReturnPath();
    navigate(next ?? rememberedPath, { replace: true });
  }

  async function resend() {
    setResendError(false);
    const { error: resendFailure } = await resendSignupCode(email);
    if (resendFailure) {
      setResendError(true);
      return;
    }
    setCooldown(60);
  }

  return (
    <AuthLayout
      eyebrow="Check your inbox"
      title="Verify your email"
      subtitle={`Enter the six-digit code sent to ${email || "your email address"}.`}
      footer={<span>Wrong email? <Link className="font-semibold text-accent underline underline-offset-4" to={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Change email</Link></span>}
    >
      <div className="space-y-5">
        {error && <ErrorMessage>{error}</ErrorMessage>}
        {resendError && <ErrorMessage>We could not resend the code. Try again shortly.</ErrorMessage>}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground-body" htmlFor="email-code">Six-digit code</label>
          <Input
            autoComplete="one-time-code"
            autoFocus
            id="email-code"
            inputMode="numeric"
            maxLength={6}
            onChange={(event) => {
              const value = event.currentTarget.value.replace(/\D/g, "").slice(0, 6);
              setCode(value);
              if (value.length === 6) void submitCode(value);
            }}
            placeholder="000000"
            value={code}
          />
        </div>
        <Button className="w-full" disabled={code.length !== 6 || submitting} onClick={() => void submitCode(code)} size="lg" type="button">
          {submitting ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <ArrowRight aria-hidden="true" className="size-4" />}
          {submitting ? "Verifying" : "Verify email"}
        </Button>
        <p className="text-center text-sm text-muted">
          {cooldown > 0 ? `Resend code in ${cooldown}s` : <button className="font-semibold text-accent underline underline-offset-4" onClick={() => void resend()} type="button">Resend code</button>}
        </p>
      </div>
    </AuthLayout>
  );
}
