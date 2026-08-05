import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type AppRole = "admin" | "staff" | "investor" | "moderator";

/**
 * Route → allowed roles. Any authenticated route not listed here defaults to
 * admin-only. `/investor` is investor-only. Home ("/") is admin-only, staff
 * land on `/inventory`, investors on `/investor`.
 */
export const ROUTE_ACCESS: Array<{ prefix: string; roles: AppRole[] }> = [
  { prefix: "/investor", roles: ["investor", "admin"] },
  { prefix: "/inventory", roles: ["admin", "staff"] },
  { prefix: "/production", roles: ["admin", "staff"] },
  { prefix: "/invoices/deleted", roles: ["admin"] },
  { prefix: "/invoices", roles: ["admin", "staff"] },
  { prefix: "/delivery-calculator", roles: ["admin", "staff"] },
  { prefix: "/expenses", roles: ["admin", "staff"] },
  { prefix: "/returns", roles: ["admin", "staff"] },
  { prefix: "/clients", roles: ["admin"] },
  { prefix: "/pnl", roles: ["admin"] },
  { prefix: "/customer-analytics", roles: ["admin"] },
  { prefix: "/investors", roles: ["admin"] },
  { prefix: "/payment-reminders", roles: ["admin"] },
  { prefix: "/payment-verifications", roles: ["admin"] },
  { prefix: "/whatsapp-logs", roles: ["admin"] },
  { prefix: "/salaries", roles: ["admin"] },
  { prefix: "/settings", roles: ["admin"] },
  // Wastage verification review queue: final approval is Admin-only inside
  // the page itself; Moderator gets read-only metadata (no image access,
  // no decision controls). Staff submit from /production instead and never
  // reach this route.
  { prefix: "/wastage-verifications", roles: ["admin", "moderator"] },
  // Stock audits: Staff submit their own count, Moderator submits the
  // Management count, Admin reconciles/locks. All three need route access;
  // the page itself restricts which actions each role can take.
  { prefix: "/stock-audits", roles: ["admin", "moderator", "staff"] },
  // Operational alerts: Admin/Moderator only, per the locked role matrix.
  { prefix: "/operational-alerts", roles: ["admin", "moderator"] },
  // Credit inventory purchases: Admin/Staff can create/edit unpaid rows;
  // Moderator gets read access (matches the backend SELECT policy). Only
  // Admin can mark paid/cancel - enforced both in the RPCs and in the UI.
  { prefix: "/credit-inventory-purchases", roles: ["admin", "staff", "moderator"] },
];

export function allowedRolesFor(pathname: string): AppRole[] {
  if (pathname === "/") return ["admin"];
  const match = ROUTE_ACCESS.find(
    (r) => pathname === r.prefix || pathname.startsWith(r.prefix + "/"),
  );
  return match?.roles ?? ["admin"];
}

export function homeForRoles(roles: AppRole[]): string {
  if (roles.includes("admin")) return "/";
  if (roles.includes("staff")) return "/inventory";
  if (roles.includes("investor")) return "/investor";
  if (roles.includes("moderator")) return "/wastage-verifications";
  return "/auth";
}

async function fetchMyRoles(userId: string): Promise<AppRole[]> {
  const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (error) throw error;
  return ((data ?? []) as Array<{ role: AppRole }>).map((r) => r.role);
}

/**
 * Tracks whether the Supabase auth session has been restored from storage.
 * Returns { userId, isReady } — isReady flips true once getSession() resolves.
 */
export function useAuthReady() {
  const [userId, setUserId] = useState<string | null>(null);
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setUserId(data.session?.user?.id ?? null);
      setIsReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user?.id ?? null);
    });
    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);
  return { userId, isReady };
}

export function useMyRoles() {
  const { userId, isReady } = useAuthReady();
  const q = useQuery({
    queryKey: ["my-roles", userId],
    queryFn: () => fetchMyRoles(userId!),
    enabled: isReady && !!userId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    retry: 1,
  });
  return {
    ...q,
    isReady,
    hasSession: !!userId,
    // Effective loading: waiting on session OR waiting on the role query itself.
    isLoading: !isReady || (!!userId && q.isLoading),
  };
}

export function useIsAdmin() {
  const q = useMyRoles();
  return { ...q, isAdmin: (q.data ?? []).includes("admin") };
}

export function useIsInvestor() {
  const q = useMyRoles();
  const roles = q.data ?? [];
  // An investor is someone who has 'investor' role but NOT admin.
  return { ...q, isInvestor: roles.includes("investor") && !roles.includes("admin") };
}

export function useIsStaffOnly() {
  const q = useMyRoles();
  const roles = q.data ?? [];
  return { ...q, isStaffOnly: roles.includes("staff") && !roles.includes("admin") };
}

export function useIsModerator() {
  const q = useMyRoles();
  const roles = q.data ?? [];
  // A moderator is someone who has the 'moderator' role but not admin -
  // admin already has full operational access and takes precedence.
  return { ...q, isModerator: roles.includes("moderator") && !roles.includes("admin") };
}

/** True for Admin or Moderator - used to gate operational review pages/actions. */
export function useIsAdminOrModerator() {
  const q = useMyRoles();
  const roles = q.data ?? [];
  return { ...q, isAdminOrModerator: roles.includes("admin") || roles.includes("moderator") };
}
