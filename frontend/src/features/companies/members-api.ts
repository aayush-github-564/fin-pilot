import type { components } from "../../api/schema";
import { api } from "../../api/client";
import { normalizeApiError } from "../../api/errors";

export type Member = components["schemas"]["MemberRead"];
export type Invitation = components["schemas"]["InvitationRead"];
export type CreatedInvitation = components["schemas"]["InvitationCreated"];
export type InvitationPreview = components["schemas"]["InvitationPreview"];
export type CompanyRole = components["schemas"]["CompanyRole"];

async function unwrap<T>(result: { response: Response; data?: T; error?: unknown }, missing: string): Promise<T> {
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
  if (result.data === undefined) throw new Error(missing);
  return result.data;
}

export async function listMembers(companyId: string) {
  return unwrap(await api.GET("/api/v1/companies/{company_id}/members", { params: { path: { company_id: companyId } } }), "No members were returned.");
}

export async function listInvitations(companyId: string) {
  return unwrap(await api.GET("/api/v1/companies/{company_id}/invitations", { params: { path: { company_id: companyId } } }), "No invitations were returned.");
}

export async function listMyInvitations() {
  return unwrap(await api.GET("/api/v1/invitations/mine"), "No invitations were returned.");
}

export async function createInvitation(companyId: string, email: string, role: CompanyRole): Promise<CreatedInvitation> {
  return unwrap(await api.POST("/api/v1/companies/{company_id}/invitations", {
    params: { path: { company_id: companyId } }, body: { email, role },
  }), "The invitation was created without a response.");
}

export async function resendInvitation(companyId: string, invitationId: string): Promise<CreatedInvitation> {
  return unwrap(await api.POST("/api/v1/companies/{company_id}/invitations/{invitation_id}/resend", {
    params: { path: { company_id: companyId, invitation_id: invitationId } },
  }), "The invitation could not be resent.");
}

export async function revokeInvitation(companyId: string, invitationId: string) {
  const result = await api.DELETE("/api/v1/companies/{company_id}/invitations/{invitation_id}", {
    params: { path: { company_id: companyId, invitation_id: invitationId } },
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
}

export async function getInvitationPreview(token: string): Promise<InvitationPreview> {
  return unwrap(await api.GET("/api/v1/invite/{token}", { params: { path: { token } } }), "Invitation details were not returned.");
}

export async function acceptInvitation(token: string) {
  return unwrap(await api.POST("/api/v1/invite/{token}/accept", { params: { path: { token } } }), "The invitation could not be accepted.");
}

export async function acceptMyInvitation(invitationId: string) {
  return unwrap(await api.POST("/api/v1/invitations/{invitation_id}/accept", { params: { path: { invitation_id: invitationId } } }), "The invitation could not be accepted.");
}

export async function updateMemberRole(companyId: string, userId: string, role: CompanyRole) {
  return unwrap(await api.PATCH("/api/v1/companies/{company_id}/members/{user_id}", {
    params: { path: { company_id: companyId, user_id: userId } }, body: { role },
  }), "The member role could not be updated.");
}

export async function removeMember(companyId: string, userId: string) {
  const result = await api.DELETE("/api/v1/companies/{company_id}/members/{user_id}", {
    params: { path: { company_id: companyId, user_id: userId } },
  });
  if (!result.response.ok) throw await normalizeApiError(result.response, result.error);
}
