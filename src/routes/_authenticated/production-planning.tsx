import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { addDays, format } from "date-fns";
import { AlertTriangle, BellRing, ClipboardList, Factory, Package, Plus, Save } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createProductionPlan,
  deactivateProductRecipe,
  finalizeProductionPlan,
  getProductionPlanningBootstrap,
  getProductionPlanningView,
  refreshProductionPlanActuals,
  saveProductRecipe,
  scanProductionPlanningNotifications,
} from "@/lib/production-planning.functions";

export const Route = createFileRoute("/_authenticated/production-planning")({
  head: () => ({ meta: [{ title: "Production Planning - Fry Guys CRM" }] }),
  component: ProductionPlanningPage,
});

type RecipeItemForm = {
  inventory_item_id: string;
  quantity_required: string;
  unit: string;
  wastage_buffer_percent: string;
  supplier_name: string;
  supplier_lead_time_hours: string;
  notes: string;
};

const todayStr = () => format(new Date(), "yyyy-MM-dd");
const num = (value: unknown) => (Number.isFinite(Number(value ?? 0)) ? Number(value ?? 0) : 0);
const fmtQty = (value: unknown, unit = "") =>
  `${num(value).toLocaleString("en", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;

const emptyRecipeItem = (): RecipeItemForm => ({
  inventory_item_id: "",
  quantity_required: "",
  unit: "",
  wastage_buffer_percent: "",
  supplier_name: "",
  supplier_lead_time_hours: "",
  notes: "",
});

function ProductionPlanningPage() {
  const qc = useQueryClient();
  const bootstrapFn = useServerFn(getProductionPlanningBootstrap);
  const viewFn = useServerFn(getProductionPlanningView);
  const saveRecipeFn = useServerFn(saveProductRecipe);
  const deactivateRecipeFn = useServerFn(deactivateProductRecipe);
  const createPlanFn = useServerFn(createProductionPlan);
  const finalizePlanFn = useServerFn(finalizeProductionPlan);
  const refreshActualsFn = useServerFn(refreshProductionPlanActuals);
  const scanNotificationsFn = useServerFn(scanProductionPlanningNotifications);

  const [windowKey, setWindowKey] = useState("today");
  const [recipeOpen, setRecipeOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [planDate, setPlanDate] = useState(todayStr());
  const [responsibleUser, setResponsibleUser] = useState("none");
  const [planNotes, setPlanNotes] = useState("");
  const [plannedQuantities, setPlannedQuantities] = useState<Record<string, string>>({});
  const [recipeForm, setRecipeForm] = useState({
    finished_product_id: "",
    name: "Default recipe",
    version: "",
    output_quantity: "",
    output_unit: "packs",
    active: true,
    items: [emptyRecipeItem()],
  });

  const windows = useMemo(() => {
    const today = todayStr();
    return [
      { key: "today", label: "Today", start_date: today, days: 1 },
      {
        key: "tomorrow",
        label: "Tomorrow",
        start_date: format(addDays(new Date(), 1), "yyyy-MM-dd"),
        days: 1,
      },
      { key: "next3", label: "Next 3 Days", start_date: today, days: 3 },
      { key: "next7", label: "Next 7 Days", start_date: today, days: 7 },
    ];
  }, []);

  const selectedWindow = windows.find((w) => w.key === windowKey) ?? windows[0];

  const bootstrapQ = useQuery({
    queryKey: ["production-planning-bootstrap"],
    queryFn: () => bootstrapFn(),
  });
  const viewQ = useQuery({
    queryKey: ["production-planning-view", selectedWindow.start_date, selectedWindow.days],
    queryFn: () =>
      viewFn({ data: { start_date: selectedWindow.start_date, days: selectedWindow.days } }),
  });

  const requirements = (viewQ.data?.requirements ?? []) as any[];
  const rawRequirements = (viewQ.data?.rawRequirements ?? []) as any[];
  const recipes = (viewQ.data?.recipes ?? []) as any[];
  const plans = (viewQ.data?.plans ?? []) as any[];
  const products = (bootstrapQ.data?.products ?? []) as any[];
  const inventory = (bootstrapQ.data?.inventory ?? []) as any[];
  const assignees = (bootstrapQ.data?.assignees ?? []) as Array<{ id: string; label: string }>;
  const canManageRecipes = Boolean(bootstrapQ.data?.canManageRecipes);
  const canManagePlans = Boolean(bootstrapQ.data?.canManagePlans);

  const selectedProduct =
    requirements.find((row) => row.product_id === selectedProductId) ?? requirements[0];
  const selectedRaw = selectedProduct
    ? rawRequirements.filter((row) => row.product_id === selectedProduct.product_id)
    : [];

  const summary = requirements.reduce(
    (acc, row) => {
      acc.required += num(row.production_required);
      acc.stock += num(row.finished_stock_available);
      acc.planned += num(row.planned_production_quantity);
      acc.shortfall += num(row.predicted_shortfall);
      return acc;
    },
    { required: 0, stock: 0, planned: 0, shortfall: 0 },
  );
  const rawShortageCount = rawRequirements.filter((row) => num(row.shortage_quantity) > 0).length;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["production-planning-view"] });
    qc.invalidateQueries({ queryKey: ["production-planning-bootstrap"] });
  };

  const saveRecipeMut = useMutation({
    mutationFn: () =>
      saveRecipeFn({
        data: {
          finished_product_id: recipeForm.finished_product_id,
          name: recipeForm.name,
          version: recipeForm.version || null,
          output_quantity: Number(recipeForm.output_quantity),
          output_unit: recipeForm.output_unit,
          active: recipeForm.active,
          items: recipeForm.items.map((item) => ({
            inventory_item_id: item.inventory_item_id,
            quantity_required: Number(item.quantity_required),
            unit: item.unit,
            wastage_buffer_percent: item.wastage_buffer_percent
              ? Number(item.wastage_buffer_percent)
              : null,
            supplier_name: item.supplier_name || null,
            supplier_lead_time_hours: item.supplier_lead_time_hours
              ? Number(item.supplier_lead_time_hours)
              : null,
            notes: item.notes || null,
          })),
        },
      }),
    onSuccess: () => {
      toast.success("Recipe saved");
      setRecipeOpen(false);
      setRecipeForm({
        finished_product_id: "",
        name: "Default recipe",
        version: "",
        output_quantity: "",
        output_unit: "packs",
        active: true,
        items: [emptyRecipeItem()],
      });
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const deactivateRecipeMut = useMutation({
    mutationFn: (recipeId: string) => deactivateRecipeFn({ data: { recipe_id: recipeId } }),
    onSuccess: () => {
      toast.success("Recipe deactivated");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const createPlanMut = useMutation({
    mutationFn: () =>
      createPlanFn({
        data: {
          plan_date: planDate,
          responsible_user: responsibleUser === "none" ? null : responsibleUser,
          notes: planNotes || null,
          items: requirements.map((row) => ({
            product_id: row.product_id,
            demand_quantity: num(row.remaining_demand),
            delivered_quantity_snapshot: num(row.already_delivered),
            finished_stock_available_snapshot: num(row.finished_stock_available),
            planned_production_quantity: Number(
              plannedQuantities[row.product_id] ?? row.production_required ?? 0,
            ),
            unit: row.unit,
            earliest_delivery_deadline: row.earliest_delivery_deadline ?? null,
            source_demand_metadata: {
              window_start: row.window_start,
              window_end: row.window_end,
              affected_order_count: row.affected_order_count,
              affected_customer_branches: row.affected_customer_branches,
              demand_policy: "ordered - delivered",
            },
          })),
        },
      }),
    onSuccess: () => {
      toast.success("Draft production plan created");
      setPlanNotes("");
      setPlannedQuantities({});
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const finalizePlanMut = useMutation({
    mutationFn: (planId: string) => finalizePlanFn({ data: { plan_id: planId } }),
    onSuccess: () => {
      toast.success("Production plan finalized");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const refreshActualsMut = useMutation({
    mutationFn: (planId: string) => refreshActualsFn({ data: { plan_id: planId } }),
    onSuccess: () => {
      toast.success("Actual production refreshed from Daily Production");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const scanNotificationsMut = useMutation({
    mutationFn: () =>
      scanNotificationsFn({
        data: { start_date: selectedWindow.start_date, days: selectedWindow.days },
      }),
    onSuccess: (result) => {
      toast.success(`${result.count} production planning notification(s) checked`);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Production Planning</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Demand, finished stock, production targets and raw-material readiness.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => scanNotificationsMut.mutate()}
          disabled={scanNotificationsMut.isPending || viewQ.data?.migration_required}
        >
          <BellRing className="mr-2 h-4 w-4" />
          Scan Risks
        </Button>
      </div>

      {viewQ.data?.migration_required && (
        <Card className="border-warning/40 bg-warning/5">
          <CardContent className="py-4 text-sm text-warning">
            Phase 5D production-planning migration is required before this page can load live data.
          </CardContent>
        </Card>
      )}

      <Tabs value={windowKey} onValueChange={setWindowKey} className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 md:w-auto md:grid-cols-4">
          {windows.map((window) => (
            <TabsTrigger key={window.key} value={window.key}>
              {window.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {windows.map((window) => (
          <TabsContent key={window.key} value={window.key} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <Metric label="Need to Produce" value={fmtQty(summary.required, "packs")} />
              <Metric label="Finished Stock" value={fmtQty(summary.stock, "packs")} />
              <Metric label="Planned Production" value={fmtQty(summary.planned, "packs")} />
              <Metric
                label="Predicted Shortfall"
                value={fmtQty(summary.shortfall, "packs")}
                tone={summary.shortfall > 0 ? "warning" : "success"}
              />
            </div>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <CardTitle className="text-base">Product Requirements</CardTitle>
                <Badge variant="outline">{rawShortageCount} raw shortage(s)</Badge>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 lg:grid-cols-2">
                  {requirements.length === 0 ? (
                    <div className="rounded-md border border-border p-6 text-center text-sm text-muted-foreground lg:col-span-2">
                      No confirmed operational demand in this window.
                    </div>
                  ) : (
                    requirements.map((row) => (
                      <button
                        key={`${row.product_id}:${row.unit}`}
                        type="button"
                        onClick={() => setSelectedProductId(row.product_id)}
                        className={`rounded-md border p-4 text-left transition hover:border-primary/50 ${
                          selectedProduct?.product_id === row.product_id
                            ? "border-primary/60 bg-primary/5"
                            : "border-border"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-medium">{row.product_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {row.affected_order_count} order(s) - earliest{" "}
                              {row.earliest_delivery_deadline ?? "-"}
                            </div>
                          </div>
                          <StatusBadge
                            shortfall={num(row.predicted_shortfall)}
                            need={num(row.production_required)}
                          />
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                          <Mini label="Demand" value={fmtQty(row.remaining_demand, row.unit)} />
                          <Mini
                            label="Stock"
                            value={fmtQty(row.finished_stock_available, row.unit)}
                          />
                          <Mini label="Need" value={fmtQty(row.production_required, row.unit)} />
                          <Mini
                            label="Planned"
                            value={fmtQty(row.planned_production_quantity, row.unit)}
                          />
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>

            {selectedProduct && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{selectedProduct.product_name} Detail</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Customer Branches</h3>
                    <div className="space-y-2">
                      {(selectedProduct.affected_customer_branches ?? []).map((branch: any) => (
                        <div
                          key={`${branch.client_id}:${branch.branch_id}`}
                          className="rounded-md border border-border p-3 text-sm"
                        >
                          <div className="font-medium">{branch.client_name}</div>
                          <div className="text-xs text-muted-foreground">{branch.branch_name}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium">Raw Materials</h3>
                    <div className="space-y-2">
                      {selectedRaw.map((raw: any, index: number) => (
                        <div
                          key={`${raw.raw_material_id ?? "none"}:${index}`}
                          className="rounded-md border border-border p-3 text-sm"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">
                                {raw.raw_material_name ?? "Recipe not configured"}
                              </div>
                              <div className="text-xs text-muted-foreground">{raw.reason}</div>
                            </div>
                            <Badge variant="outline">{raw.reorder_recommendation}</Badge>
                          </div>
                          {raw.raw_material_id && (
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
                              <Mini
                                label="Required"
                                value={fmtQty(raw.required_quantity, raw.raw_material_unit)}
                              />
                              <Mini
                                label="Available"
                                value={fmtQty(raw.available_quantity, raw.raw_material_unit)}
                              />
                              <Mini
                                label="Safety"
                                value={fmtQty(raw.safety_stock, raw.raw_material_unit)}
                              />
                              <Mini
                                label="Suggest"
                                value={fmtQty(raw.suggested_order_quantity, raw.raw_material_unit)}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        ))}
      </Tabs>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-3">
            <CardTitle className="text-base">Recipes / BOM</CardTitle>
            {canManageRecipes && (
              <Dialog open={recipeOpen} onOpenChange={setRecipeOpen}>
                <DialogTrigger asChild>
                  <Button size="sm">
                    <Plus className="mr-2 h-4 w-4" />
                    Add Recipe
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>Product Recipe</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label>Finished Product</Label>
                      <Select
                        value={recipeForm.finished_product_id}
                        onValueChange={(value) =>
                          setRecipeForm((current) => ({ ...current, finished_product_id: value }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select product" />
                        </SelectTrigger>
                        <SelectContent>
                          {products.map((product) => (
                            <SelectItem key={product.id} value={product.id}>
                              {product.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Name</Label>
                      <Input
                        value={recipeForm.name}
                        onChange={(e) =>
                          setRecipeForm((current) => ({ ...current, name: e.target.value }))
                        }
                      />
                    </div>
                    <div>
                      <Label>Output Quantity</Label>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={recipeForm.output_quantity}
                        onChange={(e) =>
                          setRecipeForm((current) => ({
                            ...current,
                            output_quantity: e.target.value,
                          }))
                        }
                      />
                    </div>
                    <div>
                      <Label>Output Unit</Label>
                      <Input
                        value={recipeForm.output_unit}
                        onChange={(e) =>
                          setRecipeForm((current) => ({ ...current, output_unit: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Raw Materials</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setRecipeForm((current) => ({
                            ...current,
                            items: [...current.items, emptyRecipeItem()],
                          }))
                        }
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        Add Line
                      </Button>
                    </div>
                    {recipeForm.items.map((item, index) => (
                      <div key={index} className="rounded-md border border-border p-3">
                        <div className="grid gap-3 md:grid-cols-4">
                          <div className="md:col-span-2">
                            <Label>Inventory Item</Label>
                            <Select
                              value={item.inventory_item_id}
                              onValueChange={(value) => {
                                const inv = inventory.find((row) => row.id === value);
                                updateRecipeItem(index, {
                                  inventory_item_id: value,
                                  unit: inv?.unit ?? item.unit,
                                });
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder="Select item" />
                              </SelectTrigger>
                              <SelectContent>
                                {inventory.map((row) => (
                                  <SelectItem key={row.id} value={row.id}>
                                    {row.item_name} ({row.unit})
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>Required</Label>
                            <Input
                              type="number"
                              min="0"
                              step="0.01"
                              value={item.quantity_required}
                              onChange={(e) =>
                                updateRecipeItem(index, { quantity_required: e.target.value })
                              }
                            />
                          </div>
                          <div>
                            <Label>Unit</Label>
                            <Input
                              value={item.unit}
                              onChange={(e) => updateRecipeItem(index, { unit: e.target.value })}
                            />
                          </div>
                          <div>
                            <Label>Buffer %</Label>
                            <Input
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              value={item.wastage_buffer_percent}
                              onChange={(e) =>
                                updateRecipeItem(index, {
                                  wastage_buffer_percent: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div>
                            <Label>Supplier</Label>
                            <Input
                              value={item.supplier_name}
                              onChange={(e) =>
                                updateRecipeItem(index, { supplier_name: e.target.value })
                              }
                            />
                          </div>
                          <div>
                            <Label>Lead Hours</Label>
                            <Input
                              type="number"
                              min="0"
                              value={item.supplier_lead_time_hours}
                              onChange={(e) =>
                                updateRecipeItem(index, {
                                  supplier_lead_time_hours: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div>
                            <Label>Notes</Label>
                            <Input
                              value={item.notes}
                              onChange={(e) => updateRecipeItem(index, { notes: e.target.value })}
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <DialogFooter>
                    <Button
                      variant="outline"
                      onClick={() => setRecipeOpen(false)}
                      disabled={saveRecipeMut.isPending}
                    >
                      Cancel
                    </Button>
                    <Button
                      onClick={() => saveRecipeMut.mutate()}
                      disabled={saveRecipeMut.isPending}
                    >
                      <Save className="mr-2 h-4 w-4" />
                      Save Recipe
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            )}
          </CardHeader>
          <CardContent className="space-y-3">
            {recipes.length === 0 ? (
              <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
                No recipes configured yet. Raw-material planning will remain unavailable until Admin
                adds real BOM values.
              </div>
            ) : (
              recipes.map((recipe) => (
                <div key={recipe.id} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{productName(recipe.finished_product_id)}</div>
                      <div className="text-xs text-muted-foreground">
                        {recipe.name} - output {fmtQty(recipe.output_quantity, recipe.output_unit)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{recipe.active ? "active" : "inactive"}</Badge>
                      {canManageRecipes && recipe.active && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deactivateRecipeMut.mutate(recipe.id)}
                        >
                          Deactivate
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    {(recipe.product_recipe_items ?? [])
                      .map(
                        (item: any) =>
                          `${fmtQty(item.quantity_required, item.unit)} ${item.inventory?.item_name ?? "item"}`,
                      )
                      .join(" - ")}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Production Plans</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {canManagePlans && (
              <div className="rounded-md border border-border p-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <Label>Plan Date</Label>
                    <Input
                      type="date"
                      value={planDate}
                      onChange={(e) => setPlanDate(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Responsible User</Label>
                    <Select value={responsibleUser} onValueChange={setResponsibleUser}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Unassigned</SelectItem>
                        {assignees.map((user) => (
                          <SelectItem key={user.id} value={user.id}>
                            {user.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Notes</Label>
                    <Input value={planNotes} onChange={(e) => setPlanNotes(e.target.value)} />
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  {requirements.map((row) => (
                    <div key={row.product_id} className="grid gap-2 md:grid-cols-[1fr_140px]">
                      <div className="text-sm">
                        <span className="font-medium">{row.product_name}</span>
                        <span className="text-muted-foreground">
                          {" "}
                          need {fmtQty(row.production_required, row.unit)}
                        </span>
                      </div>
                      <Input
                        type="number"
                        min="0"
                        step="0.01"
                        value={
                          plannedQuantities[row.product_id] ?? String(row.production_required ?? 0)
                        }
                        onChange={(e) =>
                          setPlannedQuantities((current) => ({
                            ...current,
                            [row.product_id]: e.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
                <Button
                  className="mt-3"
                  onClick={() => createPlanMut.mutate()}
                  disabled={createPlanMut.isPending || requirements.length === 0}
                >
                  <ClipboardList className="mr-2 h-4 w-4" />
                  Create Draft Plan
                </Button>
              </div>
            )}

            <div className="space-y-3">
              {plans.length === 0 ? (
                <div className="rounded-md border border-border p-6 text-sm text-muted-foreground">
                  No production plans in this window.
                </div>
              ) : (
                plans.map((plan) => (
                  <div key={plan.id} className="rounded-md border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="font-medium">{plan.plan_date}</div>
                        <div className="text-xs text-muted-foreground">
                          {plan.notes || "No notes"}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{plan.status}</Badge>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => refreshActualsMut.mutate(plan.id)}
                        >
                          Refresh Actual
                        </Button>
                        {plan.status === "draft" && (
                          <Button size="sm" onClick={() => finalizePlanMut.mutate(plan.id)}>
                            Finalize
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {(plan.production_plan_items ?? []).map((item: any) => {
                        const planned = num(item.planned_production_quantity);
                        const actual =
                          item.actual_production_quantity == null
                            ? null
                            : num(item.actual_production_quantity);
                        const variance = actual == null ? null : actual - planned;
                        const achievement =
                          actual == null || planned <= 0 ? null : (actual / planned) * 100;
                        return (
                          <div
                            key={item.id}
                            className="grid gap-2 rounded-md bg-muted/20 p-2 text-xs md:grid-cols-6"
                          >
                            <div className="font-medium md:col-span-2">
                              {item.product_name_snapshot}
                            </div>
                            <Mini label="Demand" value={fmtQty(item.demand_quantity, item.unit)} />
                            <Mini label="Planned" value={fmtQty(planned, item.unit)} />
                            <Mini
                              label="Actual"
                              value={actual == null ? "-" : fmtQty(actual, item.unit)}
                            />
                            <Mini
                              label="Variance"
                              value={
                                variance == null
                                  ? "-"
                                  : `${variance > 0 ? "+" : ""}${fmtQty(variance, item.unit)} (${achievement?.toFixed(1)}%)`
                              }
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  function updateRecipeItem(index: number, patch: Partial<RecipeItemForm>) {
    setRecipeForm((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  }

  function productName(productId: string) {
    return products.find((product) => product.id === productId)?.name ?? "Finished product";
  }
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warning" | "success";
}) {
  const toneClass =
    tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-foreground";
  return (
    <div className="rounded-md border border-border p-4">
      <div className="text-xs uppercase text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular ${toneClass}`}>{value}</div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase text-muted-foreground">{label}</div>
      <div className="font-medium tabular">{value}</div>
    </div>
  );
}

function StatusBadge({ shortfall, need }: { shortfall: number; need: number }) {
  if (shortfall > 0) {
    return (
      <Badge variant="outline" className="border-warning/40 text-warning">
        <AlertTriangle className="mr-1 h-3 w-3" />
        shortfall
      </Badge>
    );
  }
  if (need <= 0) {
    return (
      <Badge variant="outline" className="border-success/40 text-success">
        <Package className="mr-1 h-3 w-3" />
        covered
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <Factory className="mr-1 h-3 w-3" />
      plan
    </Badge>
  );
}
