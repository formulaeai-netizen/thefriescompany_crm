import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  PackageCheck,
  Plus,
  Search,
  Truck,
  X,
} from "lucide-react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fmtDate, pkr } from "@/lib/format";
import {
  ORDER_PRIORITIES,
  ORDER_SOURCES,
  ORDER_STATUSES,
  daysSinceOrder,
  daysUntilRequestedDelivery,
  deliveryLatenessDays,
  type OrderPriority,
  type OrderSource,
  type OrderStatus,
} from "@/lib/sales-orders";
import {
  cancelSalesOrder,
  confirmSalesOrder,
  confirmSalesOrderReceiving,
  createSalesOrder,
  createSalesOrderFulfillment,
  getSalesOrderBootstrap,
  getSalesOrderDemand,
  listSalesOrders,
  markSalesOrderFulfillmentDelivered,
  markSalesOrderFulfillmentDispatched,
  moveSalesOrderToPlanning,
  scanMissingReceivingIncidents,
} from "@/lib/sales-orders.functions";

export const Route = createFileRoute("/_authenticated/orders")({
  validateSearch: (search: Record<string, unknown>) => ({
    order: typeof search.order === "string" ? search.order : undefined,
  }),
  head: () => ({ meta: [{ title: "Orders - Fry Guys CRM" }] }),
  component: OrdersPage,
});

type OrderLineForm = {
  product_id: string;
  quantity: string;
  unit: string;
  unit_price: string;
  notes: string;
};

type OrderForm = {
  client_id: string;
  branch_id: string;
  requested_delivery_date: string;
  promised_delivery_date: string;
  priority: OrderPriority;
  assigned_to: string;
  customer_notes: string;
  internal_notes: string;
  items: OrderLineForm[];
};

type FulfillmentForm = {
  responsible_user: string;
  notes: string;
  quantities: Record<string, string>;
};

type ReceivingForm = {
  recipient_name: string;
  received_at: string;
  notes: string;
  quantities: Record<string, { accepted: string; rejected: string }>;
};

const emptyLine = (): OrderLineForm => ({
  product_id: "",
  quantity: "",
  unit: "packs",
  unit_price: "",
  notes: "",
});

const emptyForm = (): OrderForm => ({
  client_id: "",
  branch_id: "",
  requested_delivery_date: new Date().toISOString().slice(0, 10),
  promised_delivery_date: "",
  priority: "normal",
  assigned_to: "",
  customer_notes: "",
  internal_notes: "",
  items: [emptyLine()],
});

function statusTone(status: string) {
  if (status === "draft") return "border-muted-foreground/30 text-muted-foreground";
  if (status === "confirmed") return "border-primary/40 text-primary";
  if (status === "planning") return "border-info/40 text-info";
  if (status === "cancelled") return "border-destructive/40 text-destructive";
  return "border-warning/40 text-warning";
}

function priorityTone(priority: string) {
  if (priority === "urgent") return "border-destructive/40 text-destructive";
  if (priority === "high") return "border-warning/40 text-warning";
  return "border-muted-foreground/30 text-muted-foreground";
}

function compactItems(row: any) {
  return (row.sales_order_items ?? [])
    .slice(0, 2)
    .map(
      (item: any) =>
        `${Number(item.quantity).toLocaleString()} ${item.unit} ${item.product_name_snapshot}`,
    )
    .join(", ");
}

function numeric(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fulfillmentRows(order: any): any[] {
  return (order?.sales_order_fulfillments ?? []).filter(
    (fulfillment: any) => !["cancelled", "failed"].includes(String(fulfillment.status)),
  );
}

function fulfillmentItems(fulfillment: any): any[] {
  return fulfillment?.sales_order_fulfillment_items ?? [];
}

function lineFulfillmentTotals(order: any, line: any) {
  const totals = { planned: 0, dispatched: 0, delivered: 0, accepted: 0, rejected: 0 };
  for (const fulfillment of fulfillmentRows(order)) {
    for (const item of fulfillmentItems(fulfillment)) {
      if (item.sales_order_item_id !== line.id) continue;
      totals.planned += numeric(item.planned_quantity);
      totals.dispatched += numeric(item.dispatched_quantity);
      totals.delivered += numeric(item.delivered_quantity);
      totals.accepted += numeric(item.accepted_quantity);
      totals.rejected += numeric(item.rejected_quantity);
    }
  }
  return totals;
}

function remainingForPlanning(order: any, line: any): number {
  return Math.max(numeric(line.quantity) - lineFulfillmentTotals(order, line).planned, 0);
}

function canCreateFulfillment(order: any): boolean {
  return [
    "confirmed",
    "planning",
    "allocated",
    "ready",
    "dispatched",
    "receiving_pending",
  ].includes(String(order?.status));
}

function canConfirmReceiving(fulfillment: any): boolean {
  return fulfillment?.status === "receiving_pending";
}

function OrdersPage() {
  const qc = useQueryClient();
  const search = Route.useSearch();
  const deepLinkedOrderId = search.order ?? null;

  const listFn = useServerFn(listSalesOrders);
  const bootstrapFn = useServerFn(getSalesOrderBootstrap);
  const demandFn = useServerFn(getSalesOrderDemand);
  const createFn = useServerFn(createSalesOrder);
  const confirmFn = useServerFn(confirmSalesOrder);
  const planningFn = useServerFn(moveSalesOrderToPlanning);
  const cancelFn = useServerFn(cancelSalesOrder);
  const createFulfillmentFn = useServerFn(createSalesOrderFulfillment);
  const dispatchFulfillmentFn = useServerFn(markSalesOrderFulfillmentDispatched);
  const deliverFulfillmentFn = useServerFn(markSalesOrderFulfillmentDelivered);
  const confirmReceivingFn = useServerFn(confirmSalesOrderReceiving);
  const scanMissingReceivingFn = useServerFn(scanMissingReceivingIncidents);

  const [filters, setFilters] = useState({
    search: "",
    status: "all",
    priority: "all",
    order_source: "all",
    requested_delivery_date: "",
    branch_id: "all",
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(deepLinkedOrderId);
  const [cancelReasonById, setCancelReasonById] = useState<Record<string, string>>({});
  const [fulfillmentFormByOrder, setFulfillmentFormByOrder] = useState<
    Record<string, FulfillmentForm>
  >({});
  const [receivingFormByFulfillment, setReceivingFormByFulfillment] = useState<
    Record<string, ReceivingForm>
  >({});
  const [form, setForm] = useState<OrderForm>(emptyForm());

  const cleanFilters = {
    search: filters.search || undefined,
    status: filters.status === "all" ? undefined : (filters.status as OrderStatus),
    priority: filters.priority === "all" ? undefined : (filters.priority as OrderPriority),
    order_source:
      filters.order_source === "all" ? undefined : (filters.order_source as OrderSource),
    requested_delivery_date: filters.requested_delivery_date || undefined,
    branch_id: filters.branch_id === "all" ? undefined : filters.branch_id,
    limit: 200,
  };

  const ordersQ = useQuery({
    queryKey: ["sales-orders", cleanFilters],
    queryFn: () => listFn({ data: cleanFilters }),
  });
  const bootstrapQ = useQuery({
    queryKey: ["sales-order-bootstrap"],
    queryFn: () => bootstrapFn({}),
  });
  const demandQ = useQuery({ queryKey: ["sales-order-demand"], queryFn: () => demandFn({}) });

  const rows = (ordersQ.data?.rows ?? []) as any[];
  const clients = useMemo(
    () => (bootstrapQ.data?.clients ?? []) as any[],
    [bootstrapQ.data?.clients],
  );
  const products = useMemo(
    () => (bootstrapQ.data?.products ?? []) as any[],
    [bootstrapQ.data?.products],
  );
  const assignees = bootstrapQ.data?.assignees ?? [];
  const selectedClient = clients.find((client) => client.id === form.client_id);
  const selectedOrder = rows.find((row) => row.id === detailId);
  const today = new Date().toISOString().slice(0, 10);
  const demand = demandQ.data?.summary ?? {};
  const productDemand = (demandQ.data?.productDemand ?? []) as any[];

  const allBranches = useMemo(
    () =>
      clients.flatMap((client) =>
        (client.branches ?? []).map((branch: any) => ({
          ...branch,
          client_name: client.legal_name,
        })),
      ),
    [clients],
  );

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["sales-orders"] });
    qc.invalidateQueries({ queryKey: ["sales-order-demand"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
  };

  const createMut = useMutation({
    mutationFn: (confirm: boolean) =>
      createFn({
        data: {
          client_id: form.client_id,
          branch_id: form.branch_id || null,
          order_source: "admin",
          requested_delivery_date: form.requested_delivery_date,
          promised_delivery_date: form.promised_delivery_date || null,
          priority: form.priority,
          assigned_to: form.assigned_to || null,
          customer_notes: form.customer_notes || null,
          internal_notes: form.internal_notes || null,
          items: form.items.map((item) => ({
            product_id: item.product_id,
            quantity: Number(item.quantity),
            unit: item.unit.trim(),
            unit_price: item.unit_price.trim() ? Number(item.unit_price) : null,
            notes: item.notes.trim() || null,
          })),
          confirm,
        },
      }),
    onSuccess: (_result, confirmed) => {
      toast.success(confirmed ? "Order confirmed" : "Draft order saved");
      setDialogOpen(false);
      setForm(emptyForm());
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not create order"),
  });

  const confirmMut = useMutation({
    mutationFn: (id: string) => confirmFn({ data: { order_id: id } }),
    onSuccess: () => {
      toast.success("Order confirmed");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not confirm order"),
  });

  const planningMut = useMutation({
    mutationFn: (id: string) => planningFn({ data: { order_id: id } }),
    onSuccess: () => {
      toast.success("Order moved to planning");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not move order to planning"),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) =>
      cancelFn({ data: { order_id: id, reason: cancelReasonById[id] ?? "" } }),
    onSuccess: () => {
      toast.success("Order cancelled");
      setCancelReasonById({});
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not cancel order"),
  });

  const createFulfillmentMut = useMutation({
    mutationFn: (order: any) => {
      const draft = fulfillmentFormByOrder[order.id] ?? {
        responsible_user: order.assigned_to ?? "",
        notes: "",
        quantities: {},
      };
      const items = (order.sales_order_items ?? [])
        .map((line: any) => ({
          sales_order_item_id: line.id,
          quantity: Number(draft.quantities[line.id] ?? 0),
          notes: null,
        }))
        .filter((line: any) => Number.isFinite(line.quantity) && line.quantity > 0);
      if (items.length === 0) throw new Error("Add at least one delivery quantity");

      return createFulfillmentFn({
        data: {
          order_id: order.id,
          responsible_user: draft.responsible_user || order.assigned_to || null,
          notes: draft.notes.trim() || null,
          items,
        },
      });
    },
    onSuccess: (_result, order: any) => {
      toast.success("Delivery fulfillment planned");
      setFulfillmentFormByOrder((current) => {
        const next = { ...current };
        delete next[order.id];
        return next;
      });
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not plan fulfillment"),
  });

  const dispatchFulfillmentMut = useMutation({
    mutationFn: (fulfillmentId: string) =>
      dispatchFulfillmentFn({ data: { fulfillment_id: fulfillmentId } }),
    onSuccess: () => {
      toast.success("Delivery marked dispatched");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not dispatch fulfillment"),
  });

  const deliverFulfillmentMut = useMutation({
    mutationFn: (fulfillmentId: string) =>
      deliverFulfillmentFn({ data: { fulfillment_id: fulfillmentId } }),
    onSuccess: () => {
      toast.success("Delivery marked delivered; receiving proof is now required");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not mark delivered"),
  });

  const confirmReceivingMut = useMutation({
    mutationFn: (fulfillment: any) => {
      const draft = receivingFormByFulfillment[fulfillment.id] ?? {
        recipient_name: "",
        received_at: new Date().toISOString(),
        notes: "",
        quantities: {},
      };
      const recipientName = draft.recipient_name.trim();
      if (!recipientName) throw new Error("Recipient name is required");

      return confirmReceivingFn({
        data: {
          fulfillment_id: fulfillment.id,
          recipient_name: recipientName,
          received_at: draft.received_at || new Date().toISOString(),
          notes: draft.notes.trim() || null,
          items: fulfillmentItems(fulfillment).map((line: any) => {
            const saved = draft.quantities[line.id];
            return {
              fulfillment_item_id: line.id,
              accepted_quantity:
                saved?.accepted === undefined
                  ? numeric(line.delivered_quantity)
                  : Number(saved.accepted),
              rejected_quantity: saved?.rejected === undefined ? 0 : Number(saved.rejected),
            };
          }),
        },
      });
    },
    onSuccess: (result: any, fulfillment: any) => {
      toast.success(`Receiving confirmed; invoice ${result.invoiceId ? "created" : "updated"}`);
      setReceivingFormByFulfillment((current) => {
        const next = { ...current };
        delete next[fulfillment.id];
        return next;
      });
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not confirm receiving"),
  });

  const scanMissingReceivingMut = useMutation({
    mutationFn: () => scanMissingReceivingFn({}),
    onSuccess: (result) => {
      toast.success(
        Number(result.count ?? 0) > 0
          ? `${Number(result.count)} missing receiving incident(s) created`
          : "No missing receiving incidents",
      );
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not scan missing receiving"),
  });

  function updateLine(index: number, patch: Partial<OrderLineForm>) {
    setForm((current) => ({
      ...current,
      items: current.items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  }

  const canSubmit =
    form.client_id &&
    form.requested_delivery_date &&
    form.items.length > 0 &&
    form.items.every(
      (item) =>
        item.product_id &&
        item.unit.trim() &&
        Number.isFinite(Number(item.quantity)) &&
        Number(item.quantity) > 0,
    );

  if (ordersQ.data?.migration_required || demandQ.data?.migration_required) {
    return (
      <Card>
        <CardContent className="p-6">
          <h1 className="text-xl font-semibold">Orders migration required</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Apply Phase 5B migration before using canonical sales orders.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Sales Orders</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Canonical customer demand before invoicing, delivery or receiving.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => scanMissingReceivingMut.mutate()}
            disabled={scanMissingReceivingMut.isPending}
          >
            <AlertTriangle className="mr-1.5 h-4 w-4" /> Scan Missing Receiving
          </Button>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => setForm(emptyForm())}>
                <Plus className="mr-1.5 h-4 w-4" /> Create Order
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>Create sales order</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label>Customer</Label>
                    <Select
                      value={form.client_id}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, client_id: value, branch_id: "" }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select customer" />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id}>
                            {client.legal_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Branch</Label>
                    <Select
                      value={form.branch_id || "__none__"}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          branch_id: value === "__none__" ? "" : value,
                        }))
                      }
                      disabled={!form.client_id}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select branch" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">No branch</SelectItem>
                        {(selectedClient?.branches ?? []).map((branch: any) => (
                          <SelectItem key={branch.id} value={branch.id}>
                            {branch.branch_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="grid gap-1.5">
                    <Label>Requested delivery</Label>
                    <Input
                      type="date"
                      value={form.requested_delivery_date}
                      onChange={(e) =>
                        setForm((current) => ({
                          ...current,
                          requested_delivery_date: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Promised delivery</Label>
                    <Input
                      type="date"
                      value={form.promised_delivery_date}
                      onChange={(e) =>
                        setForm((current) => ({
                          ...current,
                          promised_delivery_date: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Priority</Label>
                    <Select
                      value={form.priority}
                      onValueChange={(value) =>
                        setForm((current) => ({ ...current, priority: value as OrderPriority }))
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ORDER_PRIORITIES.map((priority) => (
                          <SelectItem key={priority} value={priority}>
                            {priority}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Responsible</Label>
                    <Select
                      value={form.assigned_to || "__none__"}
                      onValueChange={(value) =>
                        setForm((current) => ({
                          ...current,
                          assigned_to: value === "__none__" ? "" : value,
                        }))
                      }
                      disabled={!bootstrapQ.data?.canAssign}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Unassigned" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Unassigned</SelectItem>
                        {assignees.map((assignee) => (
                          <SelectItem key={assignee.id} value={assignee.id}>
                            {assignee.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Products</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setForm((current) => ({
                          ...current,
                          items: [...current.items, emptyLine()],
                        }))
                      }
                    >
                      <Plus className="mr-1 h-3.5 w-3.5" /> Add item
                    </Button>
                  </div>
                  {form.items.map((line, index) => (
                    <div
                      key={index}
                      className="grid gap-2 rounded-lg border border-border p-3 sm:grid-cols-12"
                    >
                      <div className="sm:col-span-4">
                        <Select
                          value={line.product_id}
                          onValueChange={(value) => updateLine(index, { product_id: value })}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Product" />
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
                      <Input
                        className="sm:col-span-2"
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="Qty"
                        value={line.quantity}
                        onChange={(e) => updateLine(index, { quantity: e.target.value })}
                      />
                      <Input
                        className="sm:col-span-2"
                        placeholder="Unit"
                        value={line.unit}
                        onChange={(e) => updateLine(index, { unit: e.target.value })}
                      />
                      <Input
                        className="sm:col-span-2"
                        type="number"
                        min="0"
                        placeholder="Rate optional"
                        value={line.unit_price}
                        onChange={(e) => updateLine(index, { unit_price: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="sm:col-span-1"
                        disabled={form.items.length === 1}
                        onClick={() =>
                          setForm((current) => ({
                            ...current,
                            items: current.items.filter((_, i) => i !== index),
                          }))
                        }
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label>Customer notes</Label>
                    <Textarea
                      value={form.customer_notes}
                      onChange={(e) =>
                        setForm((current) => ({ ...current, customer_notes: e.target.value }))
                      }
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Internal notes</Label>
                    <Textarea
                      value={form.internal_notes}
                      onChange={(e) =>
                        setForm((current) => ({ ...current, internal_notes: e.target.value }))
                      }
                    />
                  </div>
                </div>
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={!canSubmit || createMut.isPending}
                    onClick={() => createMut.mutate(false)}
                  >
                    Save Draft
                  </Button>
                  <Button
                    disabled={!canSubmit || createMut.isPending}
                    onClick={() => createMut.mutate(true)}
                  >
                    Confirm Order
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Metric
          title="Confirmed Orders"
          value={rows.filter((row) => row.status === "confirmed").length}
        />
        <Metric title="Due Today" value={Number(demand.orders_today ?? 0)} />
        <Metric title="Due Tomorrow" value={Number(demand.orders_tomorrow ?? 0)} />
        <Metric title="Overdue" value={Number(demand.overdue_orders ?? 0)} tone="warning" />
        <Metric title="Demand Next 7 Days" value={Number(demand.orders_next_7_days ?? 0)} />
        <Metric
          title="Receiving Pending"
          value={rows.filter((row) => row.status === "receiving_pending").length}
          tone="warning"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Product Demand</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead className="text-right">Delivered</TableHead>
                  <TableHead className="text-right">Accepted</TableHead>
                  <TableHead className="text-right">Remaining</TableHead>
                  <TableHead className="text-right">Commercial</TableHead>
                  <TableHead className="text-right">Orders</TableHead>
                  <TableHead>Earliest</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productDemand.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="py-6 text-center text-muted-foreground">
                      No confirmed demand yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  productDemand.map((row) => (
                    <TableRow key={`${row.product_id}-${row.unit}`}>
                      <TableCell className="font-medium">{row.product_name}</TableCell>
                      <TableCell>{row.unit}</TableCell>
                      <TableCell className="text-right tabular">
                        {Number(row.delivered_quantity ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {Number(row.accepted_quantity ?? 0).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {Number(row.remaining_demand).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {Number(
                          row.commercial_remaining_demand ?? row.remaining_demand,
                        ).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular">{row.order_count}</TableCell>
                      <TableCell>{fmtDate(row.earliest_requested_delivery)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-2 md:grid-cols-6">
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={filters.search}
                onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))}
                placeholder="Search customer/order"
                className="pl-9"
              />
            </div>
            <FilterSelect
              value={filters.status}
              onValueChange={(status) => setFilters((current) => ({ ...current, status }))}
              values={ORDER_STATUSES}
              placeholder="Status"
            />
            <FilterSelect
              value={filters.priority}
              onValueChange={(priority) => setFilters((current) => ({ ...current, priority }))}
              values={ORDER_PRIORITIES}
              placeholder="Priority"
            />
            <FilterSelect
              value={filters.order_source}
              onValueChange={(source) =>
                setFilters((current) => ({ ...current, order_source: source }))
              }
              values={ORDER_SOURCES}
              placeholder="Source"
            />
            <Input
              type="date"
              value={filters.requested_delivery_date}
              onChange={(e) =>
                setFilters((current) => ({ ...current, requested_delivery_date: e.target.value }))
              }
            />
            <Select
              value={filters.branch_id}
              onValueChange={(value) => setFilters((current) => ({ ...current, branch_id: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Branch" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All branches</SelectItem>
                {allBranches.map((branch) => (
                  <SelectItem key={branch.id} value={branch.id}>
                    {branch.client_name} - {branch.branch_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="hidden overflow-x-auto md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer / Branch</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-xs">{row.order_number}</TableCell>
                    <TableCell>
                      <div className="font-medium">{row.client_name_snapshot}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.branch_name_snapshot || "No branch"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>{fmtDate(row.requested_delivery_date)}</div>
                      <div className="text-xs text-muted-foreground">
                        Age {daysSinceOrder(row, today)}d / Due in{" "}
                        {daysUntilRequestedDelivery(row, today)}d
                      </div>
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-xs text-muted-foreground">
                      {compactItems(row)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={priorityTone(row.priority)}>
                        {row.priority}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={statusTone(row.status)}>
                        {row.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <OrderActions
                        row={row}
                        onDetail={() => setDetailId(row.id)}
                        onConfirm={() => confirmMut.mutate(row.id)}
                        onPlanning={() => planningMut.mutate(row.id)}
                        onCancel={() => cancelMut.mutate(row.id)}
                        cancelReason={cancelReasonById[row.id] ?? ""}
                        setCancelReason={(reason) =>
                          setCancelReasonById((current) => ({ ...current, [row.id]: reason }))
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-3 md:hidden">
            {rows.map((row) => (
              <Card key={row.id} className="border-border/70">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-xs text-primary">{row.order_number}</div>
                      <h3 className="font-semibold">{row.client_name_snapshot}</h3>
                      <p className="text-xs text-muted-foreground">
                        {row.branch_name_snapshot || "No branch"}
                      </p>
                    </div>
                    <Badge variant="outline" className={priorityTone(row.priority)}>
                      {row.priority}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <span>Requested: {fmtDate(row.requested_delivery_date)}</span>
                    <span>Age: {daysSinceOrder(row, today)}d</span>
                    <span>Status: {row.status}</span>
                    <span>Lateness: {deliveryLatenessDays(row, today)}d</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{compactItems(row)}</p>
                  <OrderActions
                    row={row}
                    onDetail={() => setDetailId(row.id)}
                    onConfirm={() => confirmMut.mutate(row.id)}
                    onPlanning={() => planningMut.mutate(row.id)}
                    onCancel={() => cancelMut.mutate(row.id)}
                    cancelReason={cancelReasonById[row.id] ?? ""}
                    setCancelReason={(reason) =>
                      setCancelReasonById((current) => ({ ...current, [row.id]: reason }))
                    }
                  />
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {selectedOrder && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedOrder.order_number}</DialogTitle>
              </DialogHeader>
              <div className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Detail label="Customer" value={selectedOrder.client_name_snapshot} />
                  <Detail
                    label="Branch"
                    value={selectedOrder.branch_name_snapshot || "No branch"}
                  />
                  <Detail label="Source" value={selectedOrder.order_source} />
                  <Detail
                    label="Responsible"
                    value={ordersQ.data?.assigneeNames?.[selectedOrder.assigned_to] ?? "Unassigned"}
                  />
                  <Detail
                    label="Requested"
                    value={fmtDate(selectedOrder.requested_delivery_date)}
                  />
                  <Detail
                    label="Promised"
                    value={
                      selectedOrder.promised_delivery_date
                        ? fmtDate(selectedOrder.promised_delivery_date)
                        : "-"
                    }
                  />
                  <Detail label="Priority" value={selectedOrder.priority} />
                  <Detail label="Status" value={selectedOrder.status} />
                </div>
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Products</h3>
                  <div className="rounded-lg border border-border">
                    {(selectedOrder.sales_order_items ?? []).map((line: any) => {
                      const totals = lineFulfillmentTotals(selectedOrder, line);
                      return (
                        <div
                          key={line.id}
                          className="grid gap-2 border-b border-border px-3 py-2 text-sm last:border-0 sm:grid-cols-[1fr_auto]"
                        >
                          <div>
                            <div className="font-medium">{line.product_name_snapshot}</div>
                            <div className="text-xs text-muted-foreground">
                              Ordered {Number(line.quantity).toLocaleString()} {line.unit}
                              {line.unit_price != null ? ` x ${pkr(Number(line.unit_price))}` : ""}
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground sm:text-right">
                            <span>Planned: {totals.planned.toLocaleString()}</span>
                            <span>Delivered: {totals.delivered.toLocaleString()}</span>
                            <span>Accepted: {totals.accepted.toLocaleString()}</span>
                            <span>
                              Remaining:{" "}
                              {remainingForPlanning(selectedOrder, line).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                {canCreateFulfillment(selectedOrder) && (
                  <div className="rounded-lg border border-border p-3">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold">Plan Delivery Fulfillment</h3>
                      <PackageCheck className="h-4 w-4 text-primary" />
                    </div>
                    <div className="grid gap-3">
                      {(selectedOrder.sales_order_items ?? []).map((line: any) => {
                        const remaining = remainingForPlanning(selectedOrder, line);
                        if (remaining <= 0) return null;
                        const draft = fulfillmentFormByOrder[selectedOrder.id];
                        return (
                          <div key={line.id} className="grid gap-2 sm:grid-cols-[1fr_160px]">
                            <Label className="text-xs text-muted-foreground">
                              {line.product_name_snapshot} - max {remaining.toLocaleString()}{" "}
                              {line.unit}
                            </Label>
                            <Input
                              type="number"
                              min="0"
                              max={remaining}
                              step="0.01"
                              placeholder="Qty"
                              value={draft?.quantities[line.id] ?? ""}
                              onChange={(event) =>
                                setFulfillmentFormByOrder((current) => ({
                                  ...current,
                                  [selectedOrder.id]: {
                                    responsible_user:
                                      current[selectedOrder.id]?.responsible_user ??
                                      selectedOrder.assigned_to ??
                                      "",
                                    notes: current[selectedOrder.id]?.notes ?? "",
                                    quantities: {
                                      ...(current[selectedOrder.id]?.quantities ?? {}),
                                      [line.id]: event.target.value,
                                    },
                                  },
                                }))
                              }
                            />
                          </div>
                        );
                      })}
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="grid gap-1.5">
                          <Label>Responsible</Label>
                          <Select
                            value={
                              fulfillmentFormByOrder[selectedOrder.id]?.responsible_user ||
                              selectedOrder.assigned_to ||
                              "__none__"
                            }
                            onValueChange={(value) =>
                              setFulfillmentFormByOrder((current) => ({
                                ...current,
                                [selectedOrder.id]: {
                                  responsible_user: value === "__none__" ? "" : value,
                                  notes: current[selectedOrder.id]?.notes ?? "",
                                  quantities: current[selectedOrder.id]?.quantities ?? {},
                                },
                              }))
                            }
                            disabled={!bootstrapQ.data?.canAssign}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Responsible" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Unassigned</SelectItem>
                              {assignees.map((assignee) => (
                                <SelectItem key={assignee.id} value={assignee.id}>
                                  {assignee.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="grid gap-1.5">
                          <Label>Notes</Label>
                          <Input
                            value={fulfillmentFormByOrder[selectedOrder.id]?.notes ?? ""}
                            onChange={(event) =>
                              setFulfillmentFormByOrder((current) => ({
                                ...current,
                                [selectedOrder.id]: {
                                  responsible_user:
                                    current[selectedOrder.id]?.responsible_user ??
                                    selectedOrder.assigned_to ??
                                    "",
                                  notes: event.target.value,
                                  quantities: current[selectedOrder.id]?.quantities ?? {},
                                },
                              }))
                            }
                          />
                        </div>
                      </div>
                      <Button
                        type="button"
                        disabled={createFulfillmentMut.isPending}
                        onClick={() => createFulfillmentMut.mutate(selectedOrder)}
                      >
                        <PackageCheck className="mr-1.5 h-4 w-4" /> Create Fulfillment
                      </Button>
                    </div>
                  </div>
                )}
                {fulfillmentRows(selectedOrder).length > 0 && (
                  <div>
                    <h3 className="mb-2 text-sm font-semibold">Fulfillments</h3>
                    <div className="space-y-3">
                      {fulfillmentRows(selectedOrder).map((fulfillment: any) => {
                        const receivingDraft = receivingFormByFulfillment[fulfillment.id];
                        return (
                          <div key={fulfillment.id} className="rounded-lg border border-border p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <Badge variant="outline" className={statusTone(fulfillment.status)}>
                                  {fulfillment.status}
                                </Badge>
                                <span className="text-xs text-muted-foreground">
                                  {fulfillment.delivered_at
                                    ? `Delivered ${fmtDate(fulfillment.delivered_at)}`
                                    : fulfillment.dispatched_at
                                      ? `Dispatched ${fmtDate(fulfillment.dispatched_at)}`
                                      : `Planned ${fmtDate(fulfillment.planned_at)}`}
                                </span>
                              </div>
                              <div className="flex gap-2">
                                {fulfillment.status === "planned" && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => dispatchFulfillmentMut.mutate(fulfillment.id)}
                                  >
                                    <Truck className="mr-1 h-3.5 w-3.5" /> Dispatch
                                  </Button>
                                )}
                                {fulfillment.status === "dispatched" && (
                                  <Button
                                    size="sm"
                                    onClick={() => deliverFulfillmentMut.mutate(fulfillment.id)}
                                  >
                                    <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> Delivered
                                  </Button>
                                )}
                              </div>
                            </div>
                            <div className="mt-3 rounded-md bg-muted/30 text-sm">
                              {fulfillmentItems(fulfillment).map((line: any) => (
                                <div
                                  key={line.id}
                                  className="grid gap-1 border-b border-border px-3 py-2 last:border-0 sm:grid-cols-[1fr_auto]"
                                >
                                  <span>{line.product_name_snapshot}</span>
                                  <span className="text-xs text-muted-foreground sm:text-right">
                                    Planned {Number(line.planned_quantity).toLocaleString()} -
                                    Delivered {Number(line.delivered_quantity).toLocaleString()} -
                                    Accepted {Number(line.accepted_quantity).toLocaleString()}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {canConfirmReceiving(fulfillment) && (
                              <div className="mt-3 grid gap-3">
                                <div className="grid gap-2 sm:grid-cols-2">
                                  <div className="grid gap-1.5">
                                    <Label>Recipient Name</Label>
                                    <Input
                                      value={receivingDraft?.recipient_name ?? ""}
                                      onChange={(event) =>
                                        setReceivingFormByFulfillment((current) => ({
                                          ...current,
                                          [fulfillment.id]: {
                                            recipient_name: event.target.value,
                                            received_at:
                                              current[fulfillment.id]?.received_at ??
                                              new Date().toISOString(),
                                            notes: current[fulfillment.id]?.notes ?? "",
                                            quantities: current[fulfillment.id]?.quantities ?? {},
                                          },
                                        }))
                                      }
                                    />
                                  </div>
                                  <div className="grid gap-1.5">
                                    <Label>Receiving Notes</Label>
                                    <Input
                                      value={receivingDraft?.notes ?? ""}
                                      onChange={(event) =>
                                        setReceivingFormByFulfillment((current) => ({
                                          ...current,
                                          [fulfillment.id]: {
                                            recipient_name:
                                              current[fulfillment.id]?.recipient_name ?? "",
                                            received_at:
                                              current[fulfillment.id]?.received_at ??
                                              new Date().toISOString(),
                                            notes: event.target.value,
                                            quantities: current[fulfillment.id]?.quantities ?? {},
                                          },
                                        }))
                                      }
                                    />
                                  </div>
                                </div>
                                {fulfillmentItems(fulfillment).map((line: any) => {
                                  const saved = receivingDraft?.quantities[line.id];
                                  return (
                                    <div
                                      key={line.id}
                                      className="grid gap-2 sm:grid-cols-[1fr_130px_130px]"
                                    >
                                      <Label className="text-xs text-muted-foreground">
                                        {line.product_name_snapshot} - delivered{" "}
                                        {Number(line.delivered_quantity).toLocaleString()}{" "}
                                        {line.unit}
                                      </Label>
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        placeholder="Accepted"
                                        value={
                                          saved?.accepted ?? String(line.delivered_quantity ?? 0)
                                        }
                                        onChange={(event) =>
                                          setReceivingFormByFulfillment((current) => ({
                                            ...current,
                                            [fulfillment.id]: {
                                              recipient_name:
                                                current[fulfillment.id]?.recipient_name ?? "",
                                              received_at:
                                                current[fulfillment.id]?.received_at ??
                                                new Date().toISOString(),
                                              notes: current[fulfillment.id]?.notes ?? "",
                                              quantities: {
                                                ...(current[fulfillment.id]?.quantities ?? {}),
                                                [line.id]: {
                                                  accepted: event.target.value,
                                                  rejected:
                                                    current[fulfillment.id]?.quantities?.[line.id]
                                                      ?.rejected ?? "0",
                                                },
                                              },
                                            },
                                          }))
                                        }
                                      />
                                      <Input
                                        type="number"
                                        min="0"
                                        step="0.01"
                                        placeholder="Rejected"
                                        value={saved?.rejected ?? "0"}
                                        onChange={(event) =>
                                          setReceivingFormByFulfillment((current) => ({
                                            ...current,
                                            [fulfillment.id]: {
                                              recipient_name:
                                                current[fulfillment.id]?.recipient_name ?? "",
                                              received_at:
                                                current[fulfillment.id]?.received_at ??
                                                new Date().toISOString(),
                                              notes: current[fulfillment.id]?.notes ?? "",
                                              quantities: {
                                                ...(current[fulfillment.id]?.quantities ?? {}),
                                                [line.id]: {
                                                  accepted:
                                                    current[fulfillment.id]?.quantities?.[line.id]
                                                      ?.accepted ??
                                                    String(line.delivered_quantity ?? 0),
                                                  rejected: event.target.value,
                                                },
                                              },
                                            },
                                          }))
                                        }
                                      />
                                    </div>
                                  );
                                })}
                                <Button
                                  type="button"
                                  disabled={confirmReceivingMut.isPending}
                                  onClick={() => confirmReceivingMut.mutate(fulfillment)}
                                >
                                  <CheckCircle2 className="mr-1.5 h-4 w-4" /> Confirm Receiving
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                {(selectedOrder.customer_notes || selectedOrder.internal_notes) && (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Detail label="Customer notes" value={selectedOrder.customer_notes || "-"} />
                    <Detail label="Internal notes" value={selectedOrder.internal_notes || "-"} />
                  </div>
                )}
                <div>
                  <h3 className="mb-2 text-sm font-semibold">Timeline</h3>
                  <div className="space-y-2 text-sm">
                    <Timeline label="Created" value={selectedOrder.created_at} />
                    <Timeline label="Confirmed" value={selectedOrder.confirmed_at} />
                    <Timeline label="Cancelled" value={selectedOrder.cancelled_at} />
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Metric({
  title,
  value,
  tone = "default",
}: {
  title: string;
  value: number;
  tone?: "default" | "warning";
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs text-muted-foreground">{title}</p>
          <p
            className={
              tone === "warning"
                ? "tabular text-2xl font-bold text-warning"
                : "tabular text-2xl font-bold"
            }
          >
            {value.toLocaleString()}
          </p>
        </div>
        {tone === "warning" ? (
          <CalendarDays className="h-5 w-5 text-warning" />
        ) : (
          <ClipboardList className="h-5 w-5 text-primary" />
        )}
      </CardContent>
    </Card>
  );
}

function FilterSelect({
  value,
  onValueChange,
  values,
  placeholder,
}: {
  value: string;
  onValueChange: (value: string) => void;
  values: readonly string[];
  placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All {placeholder.toLowerCase()}</SelectItem>
        {values.map((item) => (
          <SelectItem key={item} value={item}>
            {item}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function OrderActions({
  row,
  onDetail,
  onConfirm,
  onPlanning,
  onCancel,
  cancelReason,
  setCancelReason,
}: {
  row: any;
  onDetail: () => void;
  onConfirm: () => void;
  onPlanning: () => void;
  onCancel: () => void;
  cancelReason: string;
  setCancelReason: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button size="sm" variant="outline" onClick={onDetail}>
        Detail
      </Button>
      {row.status === "draft" && (
        <Button size="sm" onClick={onConfirm}>
          Confirm
        </Button>
      )}
      {row.status === "confirmed" && (
        <Button size="sm" variant="secondary" onClick={onPlanning}>
          Planning
        </Button>
      )}
      {["draft", "confirmed", "planning"].includes(row.status) && (
        <Dialog>
          <DialogTrigger asChild>
            <Button size="sm" variant="ghost" className="text-destructive">
              Cancel
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Cancel {row.order_number}?</DialogTitle>
            </DialogHeader>
            <div className="grid gap-1.5">
              <Label>Reason</Label>
              <Textarea value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="destructive" disabled={!cancelReason.trim()} onClick={onCancel}>
                Cancel Order
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function Timeline({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between rounded-lg bg-muted/30 px-3 py-2">
      <span>{label}</span>
      <span className="text-muted-foreground">{fmtDate(value)}</span>
    </div>
  );
}
