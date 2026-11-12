import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { Button } from "../../components/ui/button";
import { ErrorMessage, LoadingState } from "../../components/ui/feedback";
import { takeReturnPath } from "../../lib/auth-return-path";
import { supabase } from "../../lib/supabase";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function finish() {
      const providerError = searchParams.get("error_description") ?? searchParams.get("error");
      if (providerError) {
        if (active) setError("Google sign-in was cancelled or could not be completed. Try again.");
        return;
      }
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError || !data.session) {
        setError("Google sign-in did not complete. Try again or use your email and password.");
        return;
      }
      navigate(takeReturnPath(), { replace: true });
    }
    void finish();
    return () => { active = false; };
  }, [navigate, searchParams]);

  if (!error) return <LoadingState label="Finishing Google sign-in" />;
  return (
    <main className="mx-auto max-w-md px-5 py-20">
      <div className="space-y-5 rounded-lg border border-border bg-surface p-6">
        <h1 className="fp-card-title">Sign-in did not finish</h1>
        <ErrorMessage>{error}</ErrorMessage>
        <Button asChild variant="secondary"><Link to="/login">Back to sign in</Link></Button>
      </div>
    </main>
  );
}
