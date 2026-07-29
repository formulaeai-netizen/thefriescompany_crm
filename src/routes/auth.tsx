import { createFileRoute, useNavigate, useSearch, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { homeForRoles, type AppRole } from "@/lib/roles";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth")({
  ssr: false,
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: "Sign in — Fry Guys CRM" }] }),
  beforeLoad: async ({ search }) => {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const dest = search.redirect ?? (await resolveHomeForUser(data.user.id));
      throw redirect({ to: dest });
    }
  },
  component: AuthPage,
});

async function resolveHomeForUser(userId: string): Promise<string> {
  try {
    const { data } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    const roles = ((data ?? []) as Array<{ role: AppRole }>).map((r) => r.role);
    return homeForRoles(roles);
  } catch {
    return "/";
  }
}

const credsSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(8, "Min 8 characters").max(128),
});

function AuthPage() {
  const navigate = useNavigate();
  const { redirect: redirectTo } = useSearch({ from: "/auth" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    const parsed = credsSchema.safeParse({ email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
      if (error) throw error;
      toast.success("Signed in");
      if (redirectTo) {
        navigate({ to: redirectTo });
      } else {
        const dest = data.user ? await resolveHomeForUser(data.user.id) : "/";
        navigate({ to: dest });
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-sidebar px-4 text-sidebar-foreground">
      <Card className="w-full max-w-sm border-sidebar-border bg-sidebar-accent text-sidebar-foreground shadow-2xl">
        <CardHeader>
          <div className="flex justify-center pb-2">
            <img src="/logo.png" alt="The Fries Company" style={{ height: 80, width: "auto", objectFit: "contain" }} />
          </div>
          <CardTitle className="text-center text-xl font-bold text-primary">The Fries Company</CardTitle>
          <p className="text-center text-xs uppercase tracking-widest text-sidebar-foreground/60">Fry Guys CRM</p>
          <p className="pt-2 text-sm text-sidebar-foreground/75">Sign in to access the CRM. Accounts are created by an admin.</p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div>
              <Label htmlFor="signin-email" className="text-sidebar-foreground/85">Email</Label>
              <Input id="signin-email" type="email" autoComplete="email"
                className="border-sidebar-border bg-sidebar text-sidebar-foreground placeholder:text-sidebar-foreground/35"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="signin-password" className="text-sidebar-foreground/85">Password</Label>
              <Input id="signin-password" type="password" autoComplete="current-password"
                className="border-sidebar-border bg-sidebar text-sidebar-foreground placeholder:text-sidebar-foreground/35"
                value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
            </div>
            <Button className="mt-2 w-full font-semibold"
              disabled={loading} onClick={submit}>
              {loading ? "Signing in…" : "Sign In"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}