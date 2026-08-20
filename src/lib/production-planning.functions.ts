import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type ServerContext = { supabase: any; userId: string };

async function assertAdminOrModerator(ctx: ServerContext) {
  const [{ data: isAdmin, error: adminErr }, { data: isModerator, error: moderatorErr }] =
    await Promise.all([
      ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "admin" }),
      ctx.supabase.rpc("has_role", { _user_id: ctx.userId, _role: "moderator" }),
    ]);
  if (adminErr || moderatorErr) throw new Error("Role check failed");
  if (!isAdmin && !isModerator) throw new Error("Forbidden");
  return { isAdmin: Boolean(isAdmin), isModerator: Boolean(isModerator) };
}

async function assertAdmin(ctx: ServerContext) {
  const { data: isAdmin, error } = await ctx.supabase.rpc("has_role", {
    _user_id: ctx.userId,
    _role: "admin",
  });
  if (error) throw new Error("Role check failed");
  if (!isAdmin) throw new Error("Forbidden");
}

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const windowSchema = z
  .object({
    start_date: dateSchema.optional(),
    days: z.number().int().positive().max(30).optional(),
  })
  .optional();

const recipeItemSchema = z.object({
  inventory_item_id: z.string().uuid(),
  quantity_required: z.number().positive(),
  unit: z.string().trim().min(1).max(40),
  wastage_buffer_percent: z.number().min(0).max(100).nullable().optional(),
  supplier_name: z.string().trim().max(120).nullable().optional(),
  supplier_lead_time_hours: z.number().int().min(0).max(8760).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const saveRecipeSchema = z.object({
  recipe_id: z.string().uuid().nullable().optional(),
  finished_product_id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  version: z.string().trim().max(80).nullable().optional(),
  output_quantity: z.number().positive(),
  output_unit: z.string().trim().min(1).max(40),
  active: z.boolean().optional(),
  items: z.array(recipeItemSchema).min(1),
});

const recipeIdSchema = z.object({ recipe_id: z.string().uuid() });

const planItemSchema = z.object({
  product_id: z.string().uuid(),
  demand_quantity: z.number().nonnegative(),
  delivered_quantity_snapshot: z.number().nonnegative().optional(),
  finished_stock_available_snapshot: z.number().nonnegative(),
  planned_production_quantity: z.number().nonnegative(),
  unit: z.string().trim().min(1).max(40),
  earliest_delivery_deadline: dateSchema.nullable().optional(),
  source_demand_metadata: z.record(z.unknown()).optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

const createPlanSchema = z.object({
  plan_date: dateSchema,
  responsible_user: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  items: z.array(planItemSchema).min(1),
});

const planIdSchema = z.object({ plan_id: z.string().uuid() });

export const getProductionPlanningBootstrap = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const roles = await assertAdminOrModerator(context);
    const [{ data: products, error: productsError }, { data: inventory, error: inventoryError }] =
      await Promise.all([
        (context.supabase as any)
          .from("products")
          .select("id, name")
          .eq("is_active", true)
          .order("name"),
        (context.supabase as any)
          .from("inventory")
          .select("id, item_name, unit, current_stock, minimum_stock")
          .order("item_name"),
      ]);
    if (productsError) throw new Error(`Product list failed: ${productsError.message}`);
    if (inventoryError) throw new Error(`Inventory list failed: ${inventoryError.message}`);

    let assignees: Array<{ id: string; label: string }> = [];
    if (roles.isAdmin) {
      const { data: profiles } = await (context.supabase as any)
        .from("profiles")
        .select("id, full_name, email")
        .eq("is_active", true)
        .order("full_name");
      assignees = (profiles ?? []).map((profile: any) => ({
        id: profile.id,
        label: profile.full_name || profile.email || profile.id,
      }));
    }

    return {
      products: products ?? [],
      inventory: inventory ?? [],
      assignees,
      canManageRecipes: roles.isAdmin,
      canManagePlans: roles.isAdmin || roles.isModerator,
    };
  });

export const getProductionPlanningView = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => windowSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const startDate = data?.start_date ?? new Date().toISOString().slice(0, 10);
    const days = data?.days ?? 1;
    const [
      { data: requirements, error: requirementsError },
      { data: rawRequirements, error: rawError },
      { data: recipes, error: recipesError },
      { data: plans, error: plansError },
    ] = await Promise.all([
      (context.supabase as any).rpc("production_planning_requirements", {
        _start_date: startDate,
        _days: days,
      }),
      (context.supabase as any).rpc("production_planning_raw_requirements", {
        _start_date: startDate,
        _days: days,
      }),
      (context.supabase as any)
        .from("product_recipes")
        .select(
          "id, finished_product_id, name, version, output_quantity, output_unit, active, updated_at, product_recipe_items(id, inventory_item_id, quantity_required, unit, wastage_buffer_percent, supplier_name, supplier_lead_time_hours, notes, inventory(id, item_name, unit, current_stock, minimum_stock))",
        )
        .order("updated_at", { ascending: false }),
      (context.supabase as any)
        .from("production_plans")
        .select(
          "id, plan_date, status, responsible_user, notes, created_at, finalized_at, production_plan_items(id, product_id, product_name_snapshot, demand_quantity, delivered_quantity_snapshot, finished_stock_available_snapshot, planned_production_quantity, actual_production_quantity, shortage_quantity, unit, earliest_delivery_deadline, source_demand_metadata, actual_source, notes)",
        )
        .gte("plan_date", startDate)
        .lte("plan_date", addDays(startDate, days - 1))
        .order("plan_date", { ascending: true })
        .order("created_at", { ascending: false }),
    ]);

    if (requirementsError) {
      if (requirementsError.code === "42883" || requirementsError.code === "42P01") {
        return {
          migration_required: true,
          requirements: [],
          rawRequirements: [],
          recipes: [],
          plans: [],
        };
      }
      throw new Error(`Production requirements failed: ${requirementsError.message}`);
    }
    if (rawError) throw new Error(`Raw material requirements failed: ${rawError.message}`);
    if (recipesError) throw new Error(`Recipe list failed: ${recipesError.message}`);
    if (plansError) throw new Error(`Production plan list failed: ${plansError.message}`);

    return {
      migration_required: false,
      requirements: requirements ?? [],
      rawRequirements: rawRequirements ?? [],
      recipes: recipes ?? [],
      plans: plans ?? [],
    };
  });

export const saveProductRecipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => saveRecipeSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { data: id, error } = await (context.supabase as any).rpc(
      "create_or_replace_product_recipe",
      {
        _recipe_id: data.recipe_id ?? null,
        _finished_product_id: data.finished_product_id,
        _name: data.name,
        _version: data.version ?? null,
        _output_quantity: data.output_quantity,
        _output_unit: data.output_unit,
        _active: data.active ?? true,
        _items: data.items,
      },
    );
    if (error) throw new Error(`Recipe save failed: ${error.message}`);
    return { ok: true, id };
  });

export const deactivateProductRecipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => recipeIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context);
    const { error } = await (context.supabase as any).rpc("deactivate_product_recipe", {
      _recipe_id: data.recipe_id,
    });
    if (error) throw new Error(`Recipe deactivate failed: ${error.message}`);
    return { ok: true };
  });

export const createProductionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => createPlanSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const { data: id, error } = await (context.supabase as any).rpc("create_production_plan", {
      _plan_date: data.plan_date,
      _responsible_user: data.responsible_user ?? null,
      _notes: data.notes ?? null,
      _items: data.items,
    });
    if (error) throw new Error(`Production plan creation failed: ${error.message}`);
    return { ok: true, id };
  });

export const finalizeProductionPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => planIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const { error } = await (context.supabase as any).rpc("finalize_production_plan", {
      _plan_id: data.plan_id,
    });
    if (error) throw new Error(`Production plan finalization failed: ${error.message}`);
    return { ok: true };
  });

export const refreshProductionPlanActuals = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => planIdSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const { error } = await (context.supabase as any).rpc("refresh_production_plan_actuals", {
      _plan_id: data.plan_id,
    });
    if (error) throw new Error(`Production actual refresh failed: ${error.message}`);
    return { ok: true };
  });

export const scanProductionPlanningNotifications = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data: unknown) => windowSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdminOrModerator(context);
    const { data: count, error } = await (context.supabase as any).rpc(
      "scan_production_planning_notifications",
      {
        _start_date: data?.start_date ?? new Date().toISOString().slice(0, 10),
        _days: data?.days ?? 1,
      },
    );
    if (error) throw new Error(`Production planning notification scan failed: ${error.message}`);
    return { ok: true, count: Number(count ?? 0) };
  });

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
