import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export type AppRole = "admin" | "staff" | "investor" | "viewer";

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
  { prefix: "/whatsapp-logs", roles: ["admin"] },
  { prefix: "/salaries", roles: ["admin"] },
  { prefix: "/settings", roles: ["admin"] },
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
