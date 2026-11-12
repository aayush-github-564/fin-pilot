import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../../app/auth-context";
import { useCurrentUser } from "../auth/hooks";
import { BrandLockup } from "../../components/brand/brand-lockup";
import { Button } from "../../components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ErrorMessage, LoadingState } from "../../components/ui/feedback";
import { companiesQueryKey } from "./hooks";
import { acceptInvitation, getInvitationPreview } from "./members-api";

const roleLabel = { owner: "Owner", accountant: "Admin", member: "Member", viewer: "Viewer" } as const;

export function InvitePage() {
  const { token = "" } = useParams();
  const { isAuthenticated, signOut } = useAuth();
  const user = useCurrentUser(isAuthenticated);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const invitation = useQuery({ queryKey: ["invitation", token], queryFn: () => getInvitationPreview(token), enabled: Boolean(token) });
  const accept = useMutation({
    mutationFn: () => acceptInvitation(token),
    onSuccess: async ({ company_id }) => {
      await queryClient.invalidateQueries({ queryKey: companiesQueryKey });
      navigate(`/c/${company_id}/dashboard`, { replace: true });
    },
  });

  if (invitation.isPending || (isAuthenticated && user.isPending)) return <LoadingState label="Checking invitation" />;
  if (invitation.isError) return <main className="mx-auto max-w-xl px-5 py-16"><ErrorMessage>This invitation link is invalid or could not be loaded.</ErrorMessage></main>;
  if (isAuthenticated && user.isError) return <main className="mx-auto max-w-xl px-5 py-16"><ErrorMessage>Your signed-in account could not be checked. Refresh and try again.</ErrorMessage></main>;
  const detail = invitation.data;
  const next = `/invite/${encodeURIComponent(token)}`;
  const signedInEmail = user.data?.email.toLowerCase();
  const invitedEmail = detail.invited_email.toLowerCase();
  const expired = detail.status !== "pending";

  return (
    <main className="min-h-screen bg-background px-5 py-12">
      <div className="mx-auto max-w-xl space-y-8">
        <BrandLockup className="text-pine" wordmarkClassName="text-base" />
        <Card>
          <CardHeader className="space-y-4">
            <p className="fp-eyebrow">Company invitation</p>
            <CardTitle>{expired ? "This invitation is no longer active" : `Join ${detail.company_name}`}</CardTitle>
            <CardDescription>{detail.inviter_name ? `${detail.inviter_name} invited you` : "You were invited"} as {roleLabel[detail.role]} using {detail.invited_email}.</CardDescription>
            {!expired && !isAuthenticated && <div className="flex flex-wrap gap-3"><Button asChild><Link to={`/login?next=${encodeURIComponent(next)}`}>Sign in to accept</Link></Button><Button asChild variant="secondary"><Link to={`/register?email=${encodeURIComponent(detail.invited_email)}&next=${encodeURIComponent(next)}`}>Create account</Link></Button></div>}
            {!expired && isAuthenticated && signedInEmail !== invitedEmail && <><ErrorMessage>{`This invitation is for ${detail.invited_email}. You are signed in as ${user.data?.email ?? "your account"}. Sign out and use the invited email to accept it.`}</ErrorMessage><Button onClick={() => void signOut()} type="button" variant="secondary">Switch account</Button></>}
            {!expired && isAuthenticated && signedInEmail === invitedEmail && <Button disabled={accept.isPending} onClick={() => accept.mutate()}>{accept.isPending ? "Joining company" : "Accept invitation"}</Button>}
            {expired && <Button asChild variant="secondary"><Link to="/companies">Go to workspaces</Link></Button>}
            {accept.isError && <ErrorMessage>{accept.error instanceof Error ? accept.error.message : "The invitation could not be accepted."}</ErrorMessage>}
          </CardHeader>
        </Card>
      </div>
    </main>
  );
}
