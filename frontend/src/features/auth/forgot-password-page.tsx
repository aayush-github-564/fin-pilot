import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useSearchParams } from "react-router-dom";
import { z } from "zod";

import { Button } from "../../components/ui/button";
import { ErrorMessage } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { getSafeReturnPath } from "../../lib/auth-return-path";
import { AuthLayout } from "./auth-layout";
import { sendRecoveryCode } from "./supabase-auth";

const schema = z.object({ email: z.string().trim().email("Enter a valid email address.") });
type Fields = z.infer<typeof schema>;

export function ForgotPasswordPage() {
  const [searchParams] = useSearchParams();
  const next = getSafeReturnPath(searchParams.get("next"));
  const form = useForm<Fields>({ resolver: zodResolver(schema), defaultValues: { email: "" } });
  const mutation = useMutation({
    mutationFn: async ({ email }: Fields) => {
      const { error } = await sendRecoveryCode(email);
      if (error) throw error;
    },
  });
  return (
    <AuthLayout
      eyebrow="Account recovery"
      title="Reset your password"
      subtitle="We’ll send a recovery code if an account is registered with that address."
      footer={<Link className="font-semibold text-accent underline underline-offset-4" to={`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`}>Back to sign in</Link>}
    >
      <form className="space-y-5" noValidate onSubmit={form.handleSubmit(async (values) => {
        try {
          await mutation.mutateAsync(values);
        } catch {
          // Keep the response the same so the screen does not reveal whether the email exists.
        }
      })}>
        {mutation.isError ? (
          <ErrorMessage>If an account is registered with this address, a recovery code was sent. You can continue with the code or try again later.</ErrorMessage>
        ) : null}
        {mutation.isSuccess ? (
          <div className="space-y-4 rounded-md bg-surface-raised p-4 text-sm text-foreground-body" role="status">
            <p>If an account is registered with this address, a recovery code was sent.</p>
            <Link className="inline-flex font-semibold text-accent underline underline-offset-4" to={`/reset-password?email=${encodeURIComponent(form.getValues("email"))}${next ? `&next=${encodeURIComponent(next)}` : ""}`}>Enter recovery code</Link>
          </div>
        ) : null}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground-body" htmlFor="recovery-email">Email address</label>
          <Input autoComplete="email" id="recovery-email" type="email" {...form.register("email")} />
          {form.formState.errors.email && <p className="text-sm text-negative" role="alert">{form.formState.errors.email.message}</p>}
        </div>
        <Button className="w-full" disabled={mutation.isPending} size="lg" type="submit">
          {mutation.isPending ? <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> : <ArrowRight aria-hidden="true" className="size-4" />}
          {mutation.isPending ? "Sending code" : "Send recovery code"}
        </Button>
      </form>
    </AuthLayout>
  );
}
