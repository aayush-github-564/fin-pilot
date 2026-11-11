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
import { queryClient } from "../../app/query-client";
import { currentUserQueryKey } from "./hooks";
import { AuthLayout } from "./auth-layout";
import { createAccount, signIn } from "./api";

const registerSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(1, "Choose a password."),
});

type RegisterFields = z.infer<typeof registerSchema>;

function messageFor(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "We could not create your account. Try again.";
}

export function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const nextPath = searchParams.get("next");
  const form = useForm<RegisterFields>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "" },
  });
  const registerMutation = useMutation({
    mutationFn: async (values: RegisterFields) => {
      await createAccount(values.email, values.password);
      await signIn(values.email, values.password);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
      navigate(nextPath?.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/companies", {
        replace: true,
      });
    },
  });

  return (
    <AuthLayout
      eyebrow="Start with a clear view"
      title="Create your account"
      subtitle="Set up a login first. You can create or join a company workspace next."
      footer={
        <span>
          Already have an account?{" "}
          <Link
            className="font-semibold text-accent underline decoration-accent underline-offset-4 hover:text-accent"
            to={`/login${nextPath ? `?next=${encodeURIComponent(nextPath)}` : ""}`}
          >
            Sign in
          </Link>
        </span>
      }
    >
      <form
        className="space-y-5"
        noValidate
        onSubmit={form.handleSubmit((values) => registerMutation.mutate(values))}
      >
        {registerMutation.isError && <ErrorMessage>{messageFor(registerMutation.error)}</ErrorMessage>}

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground-body" htmlFor="register-email">
            Email address
          </label>
          <Input
            autoComplete="email"
            id="register-email"
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
          <label className="text-sm font-medium text-foreground-body" htmlFor="register-password">
            Password
          </label>
          <Input
            autoComplete="new-password"
            id="register-password"
            placeholder="Choose a password"
            type="password"
            {...form.register("password")}
          />
          {form.formState.errors.password && (
            <p className="text-sm text-negative" role="alert">
              {form.formState.errors.password.message}
            </p>
          )}
          <p className="text-xs text-muted">Use the password policy configured for your account.</p>
        </div>

        <Button className="w-full" disabled={registerMutation.isPending} size="lg" type="submit">
          {registerMutation.isPending ? (
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <ArrowRight aria-hidden="true" className="size-4" />
          )}
          {registerMutation.isPending ? "Creating account" : "Create account"}
        </Button>
      </form>
    </AuthLayout>
  );
}
