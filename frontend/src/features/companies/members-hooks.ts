import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createInvitation, listInvitations, listMembers, listMyInvitations, removeMember, revokeInvitation, updateMemberRole } from "./members-api";

export const membersQueryKey = (companyId: string) => ["company", companyId, "members"] as const;
export const invitationsQueryKey = (companyId: string) => ["company", companyId, "invitations"] as const;
export const myInvitationsQueryKey = ["auth", "invitations"] as const;

export function useCompanyMembers(companyId: string) {
  return useQuery({ queryKey: membersQueryKey(companyId), queryFn: () => listMembers(companyId) });
}

export function useCompanyInvitations(companyId: string) {
  return useQuery({ queryKey: invitationsQueryKey(companyId), queryFn: () => listInvitations(companyId) });
}

export function useMyInvitations(enabled = true) {
  return useQuery({ queryKey: myInvitationsQueryKey, queryFn: listMyInvitations, enabled });
}

export function useCreateInvitation(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: Parameters<typeof createInvitation>[2] }) => createInvitation(companyId, email, role),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: invitationsQueryKey(companyId) }),
  });
}

export function useRevokeInvitation(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeInvitation(companyId, id),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: invitationsQueryKey(companyId) }),
  });
}

export function useUpdateMemberRole(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: Parameters<typeof updateMemberRole>[2] }) => updateMemberRole(companyId, userId, role),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: membersQueryKey(companyId) }),
  });
}

export function useRemoveMember(companyId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) => removeMember(companyId, userId),
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: membersQueryKey(companyId) }),
  });
}
