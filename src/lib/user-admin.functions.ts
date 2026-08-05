import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const roleEnum = z.enum(["admin", "staff", "investor", "moderator"]);

async function assertAdmin(ctx: any) {
  const { data: isAdmin, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error(`Role check failed: ${error.message}`);
  if (!isAdmin) throw new Error("Forbidden");
}

const createSchema = z.object({
  fullName: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  role: roleEnum,
});

export const createUserWithRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (created.error) throw new Error(created.error.message);
    const userId = created.data.user?.id;
    if (!userId) throw new Error("Could not create user");

    // Profile is auto-created by trigger; ensure full_name is set.
    await (supabaseAdmin as any)
      .from("profiles")
      .upsert({ id: userId, full_name: data.fullName, email: data.email });

    const { error: roleErr } = await (supabaseAdmin as any)
      .from("user_roles")
      .upsert({ user_id: userId, role: data.role }, { onConflict: "user_id,role" });
    if (roleErr) throw new Error(`Role assignment failed: ${roleErr.message}`);

    return { ok: true, userId };
  });

const updateRoleSchema = z.object({
  userId: z.string().uuid(),
  role: roleEnum,
});

export const updateUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => updateRoleSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Replace all roles for the user with the single new role.
    await (supabaseAdmin as any).from("user_roles").delete().eq("user_id", data.userId);
    const { error } = await (supabaseAdmin as any)
      .from("user_roles")
      .insert({ user_id: data.userId, role: data.role });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const emailSchema = z.object({ email: z.string().email() });

export const resetUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => emailSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: data.email,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const deactivateSchema = z.object({ userId: z.string().uuid(), active: z.boolean() });

export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => deactivateSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Ban / un-ban via auth admin
    const banDuration = data.active ? "none" : "876000h"; // ~100 years
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration: banDuration,
    } as any);
    if (error) throw new Error(error.message);
    await (supabaseAdmin as any)
      .from("profiles")
      .update({ is_active: data.active })
      .eq("id", data.userId);
    return { ok: true };
  });

export const listUsersWithRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data: profiles, error } = await (context.supabase as any)
      .from("profiles")
      .select("id, full_name, email, is_active, created_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: roleRows, error: rErr } = await (context.supabase as any)
      .from("user_roles")
      .select("user_id, role");
    if (rErr) throw new Error(rErr.message);

    const roleMap = new Map<string, string[]>();
    for (const r of roleRows ?? []) {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    }

    return (profiles ?? []).map((p: any) => ({
      ...p,
      roles: roleMap.get(p.id) ?? [],
    }));
  });
