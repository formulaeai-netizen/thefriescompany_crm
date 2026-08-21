import type { AppRole } from "./roles";

export const INTERNAL_USER_ROLES = ["admin", "staff", "investor", "moderator"] as const;
export const USER_CREATION_ROLES = [...INTERNAL_USER_ROLES, "customer"] as const;

export type PortalBranchOption = {
  id: string;
  client_id: string;
};

export function normalizeBranchIds(branchIds: string[]) {
  return [...new Set(branchIds.map((id) => id.trim()).filter(Boolean))];
}

export function validatePortalAssignment(input: {
  role: AppRole;
  clientId?: string | null;
  branchIds?: string[];
}) {
  const branchIds = normalizeBranchIds(input.branchIds ?? []);
  if (input.role !== "customer") return { clientId: null, branchIds: [] };
  if (!input.clientId) throw new Error("Select a customer / client");
  if (branchIds.length === 0) throw new Error("Select at least one allowed branch");
  return { clientId: input.clientId, branchIds };
}

export function assertBranchesBelongToClient(
  clientId: string,
  branchIds: string[],
  branches: PortalBranchOption[],
) {
  const allowed = new Set(
    branches.filter((branch) => branch.client_id === clientId).map((branch) => branch.id),
  );
  if (branchIds.some((branchId) => !allowed.has(branchId))) {
    throw new Error("Every allowed branch must belong to the selected customer");
  }
  return true;
}
