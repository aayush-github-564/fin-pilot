import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { ApiError } from "../../api/errors";
import { Button } from "../../components/ui/button";
import { ErrorMessage } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { currentUserQueryKey } from "./hooks";
import { queryClient } from "../../app/query-client";
import { AuthLayout } from "./auth-layout";
import { signIn } from "./api";

const loginSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

type LoginFields = z.infer<typeof loginSchema>;

function getSafeNextPath(value: string | null): string | null {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  if (value.startsWith("/login") || value.startsWith("/register")) return null;
  return value;
}

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "We could not sign you in. Try again.";
}

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = getSafeNextPath(searchParams.get("next"));
  const form = useForm<LoginFields>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const signInMutation = useMutation({
    mutationFn: (values: LoginFields) => signIn(values.email, values.password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
      navigate(nextPath ?? "/companies", { replace: true });
    },
  });

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title="Sign in to your workspace"
      subtitle="Use the email and password attached to your FinPilot account."
      footer={
        <span>
          New to FinPilot?{" "}
          <Link
            className="font-semibold text-accent underline decoration-accent underline-offset-4 hover:text-accent"
            to={`/register${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`}
          >
            Create an account
          </Link>
        </span>
      }
    >
      <form
        className="space-y-5"
        noValidate
        onSubmit={form.handleSubmit((values) => signInMutation.mutate(values))}
      >
        {signInMutation.isError && <ErrorMessage>{messageFor(signInMutation.error)}</ErrorMessage>}

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground-body" htmlFor="login-email">
            Email address
          </label>
          <Input
            autoComplete="email"
            id="login-email"
            inputMode="email"
            placeholder="you@company.com"
            type="email"
            {...form.register("email")}
          />
          {form.formState.errors.email && (
            <p className="text-sm text-negative" role="alert">
              {form.formState.errors.email.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-foreground-body" htmlFor="login-password">
              Password
            </label>
            <span className="text-xs text-muted">Access tokens expire after 30 minutes</span>
          </div>
          <Input
            autoComplete="current-password"
            id="login-password"
            placeholder="Your password"
            type="password"
            {...form.register("password")}
          />
          {form.formState.errors.password && (
            <p className="text-sm text-negative" role="alert">
              {form.formState.errors.password.message}
            </p>
          )}
        </div>

        <Button className="w-full" disabled={signInMutation.isPending} size="lg" type="submit">
          {signInMutation.isPending ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <ArrowRight aria-hidden="true" className="size-4" />
          )}
          {signInMutation.isPending ? "Signing in" : "Sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
