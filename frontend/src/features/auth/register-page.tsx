import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, Eye, EyeOff, LoaderCircle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { Button } from "../../components/ui/button";
import { ErrorMessage } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { getSafeReturnPath, rememberReturnPath } from "../../lib/auth-return-path";
import { AuthLayout } from "./auth-layout";
import { signUpWithEmail } from "./supabase-auth";

const registerSchema = z.object({
  full_name: z.string().trim().min(1, "Enter your name."),
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(10, "Use at least 10 characters."),
  confirm_password: z.string(),
}).refine((values) => values.password === values.confirm_password, {
  path: ["confirm_password"],
  message: "Passwords do not match.",
});
type RegisterFields = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const inviteEmail = searchParams.get("email")?.trim().toLowerCase() ?? "";
  const nextPath = getSafeReturnPath(searchParams.get("next"));
  const [showPassword, setShowPassword] = useState(false);
  const form = useForm<RegisterFields>({
    resolver: zodResolver(registerSchema),
    defaultValues: { full_name: "", email: inviteEmail, password: "", confirm_password: "" },
  });
  const createMutation = useMutation({
    mutationFn: async (values: RegisterFields) => {
      const { error } = await signUpWithEmail(values.full_name, values.email, values.password);
      if (error) throw error;
      return values.email;
    },
    onSuccess: (email) => {
      rememberReturnPath(nextPath);
      navigate(`/verify-email?email=${encodeURIComponent(email)}`, { state: { next: nextPath } });
    },
  });

  const password = form.watch("password");
  return (
    <AuthLayout
      eyebrow="Start with a clear view"
      title="Create your account"
      subtitle="Verify your email to open or join a company workspace."
      footer={<span>Already have an account? <Link className="font-semibold text-accent underline underline-offset-4" to={`/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`}>Sign in</Link></span>}
    >
      <form className="space-y-5" noValidate onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}>
        {createMutation.isError && <ErrorMessage>We could not create your account. Check your details and try again.</ErrorMessage>}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground-body" htmlFor="register-name">Full name</label>
          <Input autoComplete="name" id="register-name" placeholder="Your name" {...form.register("full_name")} />
          {form.formState.errors.full_name && <p className="text-sm text-negative" role="alert">{form.formState.errors.full_name.message}</p>}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground-body" htmlFor="register-email">Email address</label>
          <Input autoComplete="email" id="register-email" inputMode="email" readOnly={Boolean(inviteEmail)} type="email" {...form.register("email")} />
          {inviteEmail && <p className="text-xs text-muted">This invitation is addressed to this email.</p>}
          {form.formState.errors.email && <p className="text-sm text-negative" role="alert">{form.formState.errors.email.message}</p>}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground-body" htmlFor="register-password">Password</label>
          <div className="relative">
            <Input autoComplete="new-password" className="pr-12" id="register-password" type={showPassword ? "text" : "password"} {...form.register("password")} />
            <button aria-label={showPassword ? "Hide password" : "Show password"} className="absolute inset-y-0 right-2 grid w-9 place-items-center text-muted" onClick={() => setShowPassword((value) => !value)} type="button">
              {showPassword ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
            </button>
          </div>
          <p className="text-xs text-muted">
            {!password || password.length < 10
              ? "Use at least 10 characters. Longer passphrases are stronger."
              : password.length < 14
                ? "Good start. A longer passphrase is stronger."
                : "Strong length for a passphrase."}
          </p>
          {form.formState.errors.password && <p className="text-sm text-negative" role="alert">{form.formState.errors.password.message}</p>}
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground-body" htmlFor="register-confirm-password">Confirm password</label>
          <Input autoComplete="new-password" id="register-confirm-password" type={showPassword ? "text" : "password"} {...form.register("confirm_password")} />
          {form.formState.errors.confirm_password && <p className="text-sm text-negative" role="alert">{form.formState.errors.confirm_password.message}</p>}
        </div>
        <Button className="w-full" disabled={createMutation.isPending} size="lg" type="submit">
          {createMutation.isPending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <ArrowRight aria-hidden="true" className="size-4" />}
          {createMutation.isPending ? "Creating account" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
