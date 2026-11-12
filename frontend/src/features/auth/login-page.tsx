import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { Button } from "../../components/ui/button";
import { ErrorMessage } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { getSafeReturnPath, rememberReturnPath, takeReturnPath } from "../../lib/auth-return-path";
import { AuthLayout } from "./auth-layout";
import { signInWithEmail, signInWithGoogle } from "./supabase-auth";

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});
type LoginFields = z.infer<typeof loginSchema>;

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [nextPath] = useState(() => getSafeReturnPath(searchParams.get("next")) ?? takeReturnPath());
  const [googleError, setGoogleError] = useState(false);
  const form = useForm<LoginFields>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const signInMutation = useMutation({
    mutationFn: async ({ email, password }: LoginFields) => {
      const { error } = await signInWithEmail(email, password);
      if (error) throw error;
    },
    onSuccess: () => navigate(nextPath, { replace: true }),
  });

  async function continueWithGoogle() {
    setGoogleError(false);
    rememberReturnPath(nextPath);
    const { error } = await signInWithGoogle(`${window.location.origin}/auth/callback`);
    if (error) setGoogleError(true);
  }

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title="Sign in to your workspace"
      subtitle="Use the email and password attached to your FinPilot account."
      footer={<span>New to FinPilot? <Link className="font-semibold text-accent underline underline-offset-4" to={`/register${nextPath !== "/companies" ? `?next=${encodeURIComponent(nextPath)}` : ""}`}>Create an account</Link></span>}
    >
      <div className="space-y-5">
        {signInMutation.isError && <ErrorMessage>Email or password is incorrect. Check your details and try again.</ErrorMessage>}
        {googleError && <ErrorMessage>Google sign-in did not complete. Try again or use your email and password.</ErrorMessage>}
        <form className="space-y-5" noValidate onSubmit={form.handleSubmit((values) => signInMutation.mutate(values))}>
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground-body" htmlFor="login-email">Email address</label>
            <Input autoComplete="email" id="login-email" inputMode="email" placeholder="you@company.com" type="email" {...form.register("email")} />
            {form.formState.errors.email && <p className="text-sm text-negative" role="alert">{form.formState.errors.email.message}</p>}
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-foreground-body" htmlFor="login-password">Password</label>
              <Link className="text-xs font-semibold text-accent underline underline-offset-4" to={`/forgot-password${nextPath !== "/companies" ? `?next=${encodeURIComponent(nextPath)}` : ""}`}>Forgot password?</Link>
            </div>
            <Input autoComplete="current-password" id="login-password" placeholder="Your password" type="password" {...form.register("password")} />
            {form.formState.errors.password && <p className="text-sm text-negative" role="alert">{form.formState.errors.password.message}</p>}
          </div>
          <Button className="w-full" disabled={signInMutation.isPending} size="lg" type="submit">
            {signInMutation.isPending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <ArrowRight aria-hidden="true" className="size-4" />}
            {signInMutation.isPending ? "Signing in" : "Sign in"}
          </Button>
        </form>
        <div className="relative py-1 text-center text-xs text-muted"><span className="bg-surface px-3">or</span><span className="absolute inset-x-0 top-1/2 -z-10 border-t border-line" /></div>
        <Button className="w-full" disabled={signInMutation.isPending} onClick={() => void continueWithGoogle()} size="lg" variant="secondary">Continue with Google</Button>
      </div>
    </AuthLayout>
  );
}
