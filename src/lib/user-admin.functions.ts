import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  assertBranchesBelongToClient,
  normalizeBranchIds,
  validatePortalAssignment,
} from "@/lib/customer-portal-admin";

const roleEnum = z.enum(["admin", "staff", "investor", "moderator", "customer"]);
const internalRoleEnum = z.enum(["admin", "staff", "investor", "moderator"]);

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
  clientId: z.string().uuid().nullable().optional(),
  branchIds: z.array(z.string().uuid()).max(200).optional(),
});

export const createUserWithRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => createSchema.parse(d))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const portal = validatePortalAssignment({
      role: data.role,
      clientId: data.clientId,
      branchIds: data.branchIds,
    });
    if (data.role === "customer") {
      const { data: client, error: clientError } = await (context.supabase as any)
        .from("clients")
        .select("id")
        .eq("id", portal.clientId)
        .maybeSingle();
      if (clientError || !client) throw new Error("Selected customer / client does not exist");
      const { data: branches, error: branchError } = await (context.supabase as any)
        .from("branches")
        .select("id,client_id")
        .in("id", portal.branchIds);
      if (branchError) throw new Error(`Branch validation failed: ${branchError.message}`);
      assertBranchesBelongToClient(portal.clientId!, portal.branchIds, branches ?? []);
    }

    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName },
    });
    if (created.error) throw new Error(created.error.message);
    const userId = created.data.user?.id;
    if (!userId) throw new Error("Could not create user");
    try {
      // Profile is auto-created by trigger; ensure full_name is set.
      const { error: profileError } = await (supabaseAdmin as any)
        .from("profiles")
        .upsert({ id: userId, full_name: data.fullName, email: data.email });
      if (profileError) throw new Error(`Profile creation failed: ${profileError.message}`);

      const { error: roleErr } = await (supabaseAdmin as any)
        .from("user_roles")
        .upsert({ user_id: userId, role: data.role }, { onConflict: "user_id,role" });
      if (roleErr) throw new Error(`Role assignment failed: ${roleErr.message}`);

      if (data.role === "customer") {
        const { error: portalError } = await (context.supabase as any).rpc(
          "set_customer_portal_access",
          {
            _user_id: userId,
            _client_id: portal.clientId,
            _branch_ids: portal.branchIds,
            _is_active: true,
          },
        );
        if (portalError) throw new Error(`Portal access creation failed: ${portalError.message}`);
      }

      return { ok: true, userId };
    } catch (error) {
      // Auth creation is outside the database transaction. Compensate so a
      // failed role/portal mapping never leaves a partial login behind.
      await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
      throw error;
    }
  });

const updateRoleSchema = z.object({
  userId: z.string().uuid(),
  role: internalRoleEnum,
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

export const listCustomerPortalOptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context);
    const { data, error } = await (context.supabase as any)
      .from("clients")
      .select("id,legal_name,branches(id,client_id,branch_name,city)")
      .order("legal_name");
    if (error) throw new Error(`Customer list failed: ${error.message}`);
    return (data ?? []).map((client: any) => ({
      id: client.id,
      legal_name: client.legal_name,
      branches: [...(client.branches ?? [])].sort((left: any, right: any) =>
        String(left.branch_name).localeCompare(String(right.branch_name)),
      ),
    }));
  });

const portalAccessSchema = z.object({
  userId: z.string().uuid(),
  clientId: z.string().uuid().nullable().optional(),
  branchIds: z.array(z.string().uuid()).max(200),
  active: z.boolean(),
});

export const updateCustomerPortalAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => portalAccessSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const branchIds = normalizeBranchIds(data.branchIds);
    if (data.active && branchIds.length === 0) {
      throw new Error("Select at least one allowed branch");
    }

    const { data: identity, error: identityError } = await (context.supabase as any)
      .from("customer_portal_identities")
      .select("user_id,client_id")
      .eq("user_id", data.userId)
      .maybeSingle();
    if (identityError) throw new Error(`Portal identity lookup failed: ${identityError.message}`);
    const clientId = identity?.client_id ?? data.clientId;
    if (!clientId) throw new Error("Select a customer / client");

    const { data: customerRole, error: roleError } = await (context.supabase as any)
      .from("user_roles")
      .select("user_id")
      .eq("user_id", data.userId)
      .eq("role", "customer")
      .maybeSingle();
    if (roleError) throw new Error(`Customer role lookup failed: ${roleError.message}`);
    if (!customerRole) throw new Error("Target user must have the customer role");

    if (branchIds.length > 0) {
      const { data: branches, error: branchError } = await (context.supabase as any)
        .from("branches")
        .select("id,client_id")
        .in("id", branchIds);
      if (branchError) throw new Error(`Branch validation failed: ${branchError.message}`);
      assertBranchesBelongToClient(clientId, branchIds, branches ?? []);
    }

    const { error } = await (context.supabase as any).rpc("set_customer_portal_access", {
      _user_id: data.userId,
      _client_id: clientId,
      _branch_ids: branchIds,
      _is_active: data.active,
    });
    if (error) throw new Error(`Portal access update failed: ${error.message}`);
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

    const [{ data: identities, error: identityError }, { data: branchAccess, error: accessError }] =
      await Promise.all([
        (context.supabase as any)
          .from("customer_portal_identities")
          .select("user_id,client_id,is_active"),
        (context.supabase as any).from("customer_portal_branch_access").select("user_id,branch_id"),
      ]);
    if (identityError) throw new Error(`Portal identity list failed: ${identityError.message}`);
    if (accessError) throw new Error(`Portal branch list failed: ${accessError.message}`);

    const roleMap = new Map<string, string[]>();
    for (const r of roleRows ?? []) {
      const arr = roleMap.get(r.user_id) ?? [];
      arr.push(r.role);
      roleMap.set(r.user_id, arr);
    }

    const identityMap = new Map<string, any>(
      (identities ?? []).map((row: any) => [row.user_id, row]),
    );
    const branchMap = new Map<string, string[]>();
    for (const access of branchAccess ?? []) {
      branchMap.set(access.user_id, [...(branchMap.get(access.user_id) ?? []), access.branch_id]);
    }

    return (profiles ?? []).map((p: any) => ({
      ...p,
      roles: roleMap.get(p.id) ?? [],
      portalAccess: identityMap.has(p.id)
        ? {
            clientId: identityMap.get(p.id).client_id,
            active: identityMap.get(p.id).is_active,
            branchIds: branchMap.get(p.id) ?? [],
          }
        : null,
    }));
  });
