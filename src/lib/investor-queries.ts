import { supabase } from "@/lib/supabase";

export type Investor = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  investment_amount: number;
  roi_percentage: number;
  investment_date: string;
  investment_end_date: string;
  duration_years: number;
  status: string;
  notes: string | null;
  created_at: string;
};

export type InvestorReturn = {
  id: string;
  investor_id: string;
  month: string;
  net_profit: number;
  return_amount: number;
  return_percentage: number;
  paid: boolean;
  paid_date: string | null;
  notes: string | null;
  created_at: string;
};

export async function fetchInvestors(): Promise<Investor[]> {
  const { data, error } = await supabase
    .from("investors")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Investor[];
}

export async function fetchInvestor(id: string): Promise<Investor | null> {
  const { data, error } = await supabase.from("investors").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as Investor | null;
}

export async function fetchReturnsForInvestor(investorId: string): Promise<InvestorReturn[]> {
  const { data, error } = await supabase
    .from("investor_returns")
    .select("*")
    .eq("investor_id", investorId)
    .order("month", { ascending: true });
  if (error) throw error;
  return (data ?? []) as InvestorReturn[];
}

export async function fetchAllReturns(): Promise<InvestorReturn[]> {
  const { data, error } = await supabase
    .from("investor_returns")
    .select("*")
    .order("month", { ascending: false });
  if (error) throw error;
  return (data ?? []) as InvestorReturn[];
}

export async function fetchMyInvestor(): Promise<Investor | null> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user?.email) return null;
  const { data, error } = await supabase
    .from("investors")
    .select("*")
    .ilike("email", u.user.email)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as Investor | null;
}

export function monthlyReturn(amount: number, roiPct: number) {
  return (Number(amount) * Number(roiPct)) / 100 / 12;
}

export function projectedTotal(amount: number, roiPct: number, years: number) {
  return (Number(amount) * Number(roiPct) * Number(years)) / 100;
}

export function addYears(dateStr: string, years: number): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const wholeYears = Math.floor(years);
  const monthsExtra = Math.round((years - wholeYears) * 12);
  d.setFullYear(d.getFullYear() + wholeYears);
  d.setMonth(d.getMonth() + monthsExtra);
  return d.toISOString().slice(0, 10);
}

export function monthsBetween(startStr: string, endStr: string): number {
  const s = new Date(startStr);
  const e = new Date(endStr);
  return Math.max(0, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()));
}