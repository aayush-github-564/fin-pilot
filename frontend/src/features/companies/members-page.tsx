import { useState, type FormEvent } from "react";
import { Copy, MailPlus, RefreshCw, UserMinus } from "lucide-react";

import { ApiError } from "../../api/errors";
import { useCompany } from "./company-context";
import { useRole } from "./company-context";
import { useCompanyInvitations, useCompanyMembers, useCreateInvitation, useRemoveMember, useRevokeInvitation, useUpdateMemberRole } from "./members-hooks";
import { resendInvitation, type CompanyRole } from "./members-api";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { ErrorMessage, LoadingState } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";

const grantableRoles: CompanyRole[] = ["accountant", "member", "viewer", "owner"];
const roleLabels: Record<CompanyRole, string> = { owner: "Owner", accountant: "Admin", member: "Member", viewer: "Viewer" };

export function MembersPage() {
  const company = useCompany();
  const { role } = useRole();
  const queryClient = useQueryClient();
  const members = useCompanyMembers(company.company_id);
  const invitations = useCompanyInvitations(company.company_id);
  const createInvite = useCreateInvitation(company.company_id);
  const revokeInvite = useRevokeInvitation(company.company_id);
  const changeRole = useUpdateMemberRole(company.company_id);
  const removeMember = useRemoveMember(company.company_id);
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<CompanyRole>("member");
  const [inviteLink, setInviteLink] = useState("");
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const roles = role === "owner" ? grantableRoles : grantableRoles.filter((value) => value !== "owner");

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setFeedback("");
    try {
      const created = await createInvite.mutateAsync({ email, role: inviteRole });
      setInviteLink(created.invite_url);
      setFeedback(created.email_queued ? "Invitation queued for email delivery." : "Invitation created. Copy the link to share it.");
      setEmail("");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "We could not create the invitation. Try again.");
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setFeedback("Invitation link copied.");
    } catch {
      setInviteLink(link);
      setFeedback("Copy the invitation link from the field below.");
    }
  }

  async function resend(invitationId: string) {
    setError("");
    try {
      const created = await resendInvitation(company.company_id, invitationId);
      setInviteLink(created.invite_url);
      setFeedback("Invitation link refreshed. Copy it to share the new link.");
      await queryClient.invalidateQueries({ queryKey: ["company", company.company_id, "invitations"] });
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "The invitation could not be resent.");
    }
  }

  if (members.isPending || invitations.isPending) return <LoadingState label="Loading company members" />;
  if (members.isError || invitations.isError) return <ErrorMessage>Company member details could not be loaded. Refresh and try again.</ErrorMessage>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="fp-eyebrow">Workspace access</p>
        <h1 className="fp-page-title mt-2">Company <em>members</em></h1>
        <p className="mt-2 text-sm leading-6 text-muted">Invite people and manage the access they have to {company.name}.</p>
      </div>

      <Card>
        <CardHeader><CardTitle>Invite someone</CardTitle><CardDescription>Invitations expire after seven days. Share the link if email delivery is unavailable.</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto]" onSubmit={(event) => void invite(event)}>
            <Input autoComplete="email" aria-label="Email address" onChange={(event) => setEmail(event.currentTarget.value)} placeholder="name@company.com" required type="email" value={email} />
            <Select aria-label="Invite role" onChange={(event) => setInviteRole(event.currentTarget.value as CompanyRole)} value={inviteRole}>
              {roles.map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}
            </Select>
            <Button disabled={createInvite.isPending} type="submit"><MailPlus aria-hidden="true" className="size-4" />{createInvite.isPending ? "Creating" : "Create invite"}</Button>
          </form>
          {error && <ErrorMessage>{error}</ErrorMessage>}
          {feedback && <p className="text-sm text-muted" role="status">{feedback}</p>}
          {inviteLink && <div className="flex flex-wrap gap-2"><Input aria-label="Invitation link" readOnly value={inviteLink} /><Button onClick={() => void copyLink(inviteLink)} type="button" variant="secondary"><Copy aria-hidden="true" className="size-4" />Copy link</Button></div>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>People</CardTitle><CardDescription>{members.data.length} current {members.data.length === 1 ? "member" : "members"}</CardDescription></CardHeader>
        <CardContent className="divide-y divide-line">
          {members.data.map((member) => (
            <div className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0" key={member.user_id}>
              <div className="min-w-48"><p className="font-semibold text-foreground-body">{member.full_name || member.email}</p><p className="text-sm text-muted">{member.email}</p></div>
              <div className="flex items-center gap-2">
                <Select aria-label={`Role for ${member.email}`} onChange={(event) => changeRole.mutate({ userId: member.user_id, role: event.currentTarget.value as CompanyRole })} value={member.role}>
                  {[...new Set([...roles, member.role])].map((value) => <option key={value} value={value}>{roleLabels[value]}</option>)}
                </Select>
                {member.role !== "owner" && <Button aria-label={`Remove ${member.email}`} disabled={removeMember.isPending} onClick={() => removeMember.mutate(member.user_id)} size="icon" type="button" variant="quiet"><UserMinus aria-hidden="true" className="size-4" /></Button>}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Pending invitations</CardTitle><CardDescription>Active invitations that have not been accepted.</CardDescription></CardHeader>
        <CardContent className="divide-y divide-line">
          {invitations.data.length === 0 ? <p className="text-sm text-muted">There are no pending invitations.</p> : invitations.data.map((invitation) => (
            <div className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0" key={invitation.id}>
              <div><p className="font-semibold text-foreground-body">{invitation.email}</p><p className="text-sm text-muted">{roleLabels[invitation.role]} · Expires {new Date(invitation.expires_at).toLocaleDateString()}</p></div>
              <div className="flex gap-2"><Button onClick={() => void resend(invitation.id)} size="sm" type="button" variant="secondary"><RefreshCw aria-hidden="true" className="size-4" />Resend</Button><Button onClick={() => revokeInvite.mutate(invitation.id)} size="sm" type="button" variant="quiet">Revoke</Button></div>
            </div>
          ))}
        </CardContent>
      </Card>
      {(changeRole.isError || removeMember.isError || revokeInvite.isError) && <ErrorMessage>{changeRole.error instanceof Error ? changeRole.error.message : removeMember.error instanceof Error ? removeMember.error.message : revokeInvite.error instanceof Error ? revokeInvite.error.message : "This change could not be completed."}</ErrorMessage>}
    </div>
  );
}
