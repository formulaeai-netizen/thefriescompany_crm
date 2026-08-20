import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { fetchExpenses } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { pkr, fmtDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { FinancialAccountSelect } from "@/components/financial-account-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon, Trash2, Pencil, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { EXPENSE_GROUPS, GROUP_NAMES, type ExpenseGroup } from "@/lib/expense-categories";
import { useIsAdmin } from "@/lib/roles";
import { createExpense, deleteExpense, updateExpense } from "@/lib/expenses.functions";
import { listFinancialAccounts } from "@/lib/financial-accounts.functions";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/expenses")({
  head: () => ({ meta: [{ title: "Expenses — TFC CRM" }] }),
  component: ExpensesPage,
});

const GROUP_BADGE_CLASS: Record<ExpenseGroup, string> = {
  "Fixed Overhead": "border-primary/40 bg-primary/10 text-primary",
  "Variable Costs": "border-primary/30 bg-primary/5 text-primary",
  "One-Time / Other": "border-muted-foreground/30 bg-muted text-muted-foreground",
};

function ExpensesPage() {
  const qc = useQueryClient();
  const { isAdmin } = useIsAdmin();
  const { data: expenses = [] } = useQuery({ queryKey: ["expenses"], queryFn: fetchExpenses });
  const accountsFn = useServerFn(listFinancialAccounts);
  const createExpenseFn = useServerFn(createExpense);
  const deleteExpenseFn = useServerFn(deleteExpense);
  const { data: accountData } = useQuery({
    queryKey: ["financial-accounts"],
    queryFn: () => accountsFn({}),
    enabled: isAdmin,
  });
  const [item, setItem] = useState("");
  const [price, setPrice] = useState("");
  const [group, setGroup] = useState<ExpenseGroup>("Variable Costs");
  const [subcategory, setSubcategory] = useState<string>(EXPENSE_GROUPS["Variable Costs"][0]);
  const [date, setDate] = useState<Date>(new Date());
  const [paidFromAccountId, setPaidFromAccountId] = useState("");
  const [editing, setEditing] = useState<any | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const currentMonthKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }, []);
  const [monthFilter, setMonthFilter] = useState<string>(currentMonthKey);
  const [dateFilter, setDateFilter] = useState<Date | null>(null);

  const today = useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const searchQ = search.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!searchQ) return [];
    return (expenses as any[]).filter((e) => {
      const hay =
        `${e.item ?? ""} ${e.category ?? ""} ${e.subcategory ?? ""} ${e.added_by_name ?? e.added_by ?? ""}`.toLowerCase();
      return hay.includes(searchQ);
    });
  }, [expenses, searchQ]);

  const monthOptions = useMemo(() => {
    const set = new Set<string>();
    for (const e of expenses as any[]) {
      const d = new Date(e.date);
      set.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    }
    set.add(currentMonthKey);
    // Fill in every month between earliest and current
    const keys = Array.from(set).sort();
    if (keys.length > 0) {
      const [sy, sm] = keys[0].split("-").map(Number);
      const now = new Date();
      const cy = now.getFullYear();
      const cm = now.getMonth() + 1;
      const filled = new Set<string>();
      let y = sy,
        m = sm;
      while (y < cy || (y === cy && m <= cm)) {
        filled.add(`${y}-${String(m).padStart(2, "0")}`);
        m++;
        if (m > 12) {
          m = 1;
          y++;
        }
      }
      return Array.from(filled).sort((a, b) => (a < b ? 1 : -1));
    }
    return [currentMonthKey];
  }, [expenses, currentMonthKey]);

  const monthFilteredExpensesRaw = useMemo(() => {
    return (expenses as any[]).filter((e) => {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      return key === monthFilter;
    });
  }, [expenses, monthFilter]);

  const monthFilteredExpenses = useMemo(() => {
    if (!dateFilter) return monthFilteredExpensesRaw;
    const key = format(dateFilter, "yyyy-MM-dd");
    return monthFilteredExpensesRaw.filter((e: any) => String(e.date).slice(0, 10) === key);
  }, [monthFilteredExpensesRaw, dateFilter]);

  const total = monthFilteredExpenses.reduce((s: number, e: any) => s + Number(e.price), 0);

  const monthLabel = (key: string) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  };

  const grouped = useMemo(() => {
    const map = new Map<string, { key: string; label: string; total: number; items: any[] }>();
    for (const e of monthFilteredExpenses) {
      const d = new Date(e.date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
      const g = map.get(key) ?? { key, label, total: 0, items: [] };
      g.total += Number(e.price);
      g.items.push(e);
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => (a.key < b.key ? 1 : -1));
  }, [monthFilteredExpenses]);

  const add = async () => {
    if (!item || !price) return toast.error("Item and price required");
    if (!paidFromAccountId) return toast.error("Paid From account is required");
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) return toast.error("Not signed in");
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, email")
      .eq("id", uid)
      .maybeSingle();
    const addedByName =
      ((prof as any)?.full_name ?? "").trim() ||
      ((userRes.user?.user_metadata as any)?.full_name ?? "") ||
      (prof as any)?.email ||
      userRes.user?.email ||
      "";
    try {
      await createExpenseFn({
        data: {
          item,
          price: Number(price),
          category: group,
          subcategory,
          added_by: addedByName,
          date: format(date, "yyyy-MM-dd"),
          paid_from_account_id: paidFromAccountId,
        },
      });
    } catch (error: any) {
      return toast.error(error?.message ?? "Expense creation failed");
    }
    toast.success("Expense added");
    setItem("");
    setPrice("");
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["financial-account-balances"] });
  };

  const del = async (id: string) => {
    try {
      await deleteExpenseFn({ data: { expense_id: id } });
    } catch (error: any) {
      return toast.error(error?.message ?? "Expense delete failed");
    }
    toast.success("Expense deleted");
    qc.invalidateQueries({ queryKey: ["expenses"] });
    qc.invalidateQueries({ queryKey: ["financial-account-balances"] });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Expenses</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Today's spend is included in the 8 PM daily group report.
        </p>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-5 md:grid-cols-[1.1fr_1.6fr_0.9fr_1fr_1fr_1fr_auto]">
          <div>
            <Label>Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !date && "text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {date ? format(date, "PPP") : <span>Pick a date</span>}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && setDate(d)}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <Label>Item</Label>
            <Input
              value={item}
              onChange={(e) => setItem(e.target.value)}
              placeholder="e.g. Maida"
            />
          </div>
          <div>
            <Label>Price (Rs.)</Label>
            <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <Label>Group</Label>
            <Select
              value={group}
              onValueChange={(v) => {
                const g = v as ExpenseGroup;
                setGroup(g);
                setSubcategory(EXPENSE_GROUPS[g][0]);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GROUP_NAMES.map((g) => (
                  <SelectItem key={g} value={g}>
                    {g}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Subcategory</Label>
            <Select value={subcategory} onValueChange={setSubcategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_GROUPS[group].map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Paid From</Label>
            <FinancialAccountSelect
              accounts={accountData?.rows ?? []}
              value={paidFromAccountId}
              onValueChange={setPaidFromAccountId}
              placeholder="Cash or Bank"
            />
          </div>
          <div className="flex items-end">
            <Button data-financial-action onClick={add} className="w-full">
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search expenses by item, category, subcategory..."
          className="pl-9 pr-9"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Label htmlFor="month-filter" className="text-sm font-medium text-muted-foreground">
            Month
          </Label>
          <Select value={monthFilter} onValueChange={setMonthFilter}>
            <SelectTrigger id="month-filter" className="h-9 w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((k) => (
                <SelectItem key={k} value={k}>
                  {monthLabel(k)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className={cn("h-9 gap-2", dateFilter && "border-primary/50 text-primary")}
              >
                <CalendarIcon className="h-4 w-4" />
                {dateFilter ? format(dateFilter, "PPP") : "Filter by date"}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dateFilter ?? undefined}
                onSelect={(d) => d && setDateFilter(d)}
                initialFocus
                className={cn("p-3 pointer-events-auto")}
              />
            </PopoverContent>
          </Popover>
          {dateFilter && (
            <Button variant="ghost" size="sm" className="h-9" onClick={() => setDateFilter(null)}>
              <X className="mr-1 h-3.5 w-3.5" /> Show all
            </Button>
          )}
        </div>
        <span className="tabular text-sm">
          Total ({dateFilter ? fmtDate(dateFilter) : monthLabel(monthFilter)}):{" "}
          <strong className="text-primary">{pkr(total)}</strong>
        </span>
      </div>

      {expenses.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No expenses yet.
          </CardContent>
        </Card>
      )}

      {searchQ ? (
        <section className="space-y-3">
          <div className="rounded-xl border border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground">
            Showing <strong className="text-primary">{searchResults.length}</strong> results for "
            {search}"
          </div>
          {searchResults.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No matches.
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {searchResults.map((e: any) => (
                <div
                  key={e.id}
                  className="group flex flex-col gap-3 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-primary/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">{fmtDate(e.date)}</span>
                    {isAdmin && (
                      <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        <Button
                          data-financial-action
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          title="Edit"
                          onClick={() => setEditing(e)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          data-financial-action
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-foreground/70 hover:bg-muted"
                          title="Delete"
                          onClick={() => del(e.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="text-lg font-bold leading-tight">{e.item}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn("border", GROUP_BADGE_CLASS[e.category as ExpenseGroup] ?? "")}
                    >
                      {e.category}
                    </Badge>
                    {e.subcategory && (
                      <span className="text-xs text-muted-foreground">{e.subcategory}</span>
                    )}
                  </div>
                  <div className="tabular text-2xl font-bold text-foreground">
                    {pkr(Number(e.price))}
                  </div>
                  <div className="mt-auto border-t border-border/40 pt-2 text-xs text-muted-foreground">
                    Added by {e.added_by_name ?? e.added_by ?? "—"}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : (
        grouped.map((section) => {
          const isOpen = !collapsed[section.key];
          return (
            <section key={section.key} className="space-y-3">
              <button
                type="button"
                onClick={() => setCollapsed((c) => ({ ...c, [section.key]: isOpen }))}
                className="flex w-full items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3 text-left transition-colors hover:border-primary/30"
              >
                <div className="flex items-center gap-2">
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-primary" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-primary" />
                  )}
                  <span className="text-base font-semibold">{section.label}</span>
                  <span className="text-xs text-muted-foreground">({section.items.length})</span>
                </div>
                <span className="tabular text-sm font-semibold text-primary">
                  {pkr(section.total)}
                </span>
              </button>

              {isOpen && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {section.items.map((e: any) => (
                    <div
                      key={e.id}
                      className="group flex flex-col gap-3 rounded-xl border border-border/50 bg-card p-4 transition-colors hover:border-primary/30"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-medium text-foreground">
                          {fmtDate(e.date)}
                        </span>
                        {isAdmin && (
                          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              title="Edit"
                              onClick={() => setEditing(e)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-7 w-7 text-foreground/70 hover:bg-muted"
                                  title="Delete"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete this expense?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Delete {e.item} — {pkr(Number(e.price))} on {fmtDate(e.date)}?
                                    This cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction
                                    data-financial-action
                                    onClick={() => del(e.id)}
                                  >
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        )}
                      </div>
                      <div className="text-lg font-bold leading-tight">{e.item}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant="outline"
                          className={cn(
                            "border",
                            GROUP_BADGE_CLASS[e.category as ExpenseGroup] ?? "",
                          )}
                        >
                          {e.category}
                        </Badge>
                        {e.subcategory && (
                          <span className="text-xs text-muted-foreground">{e.subcategory}</span>
                        )}
                      </div>
                      <div className="tabular text-2xl font-bold text-foreground">
                        {pkr(Number(e.price))}
                      </div>
                      <div className="mt-auto border-t border-border/40 pt-2 text-xs text-muted-foreground">
                        Added by {e.added_by_name ?? e.added_by ?? "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          );
        })
      )}

      {isAdmin && (
        <EditExpenseDialog
          expense={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ["expenses"] });
            qc.invalidateQueries({ queryKey: ["financial-account-balances"] });
          }}
        />
      )}
    </div>
  );
}

function EditExpenseDialog({
  expense,
  onClose,
  onSaved,
}: {
  expense: any | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = !!expense;
  const [item, setItem] = useState("");
  const [price, setPrice] = useState("");
  const [group, setGroup] = useState<ExpenseGroup>("Variable Costs");
  const [subcategory, setSubcategory] = useState<string>("");
  const [date, setDate] = useState<Date>(new Date());
  const [addedBy, setAddedBy] = useState("");
  const [saving, setSaving] = useState(false);
  const updateExpenseFn = useServerFn(updateExpense);

  // Reset fields whenever a new expense opens
  useEffect(() => {
    if (expense) {
      setItem(expense.item ?? "");
      setPrice(String(expense.price ?? ""));
      const g = (GROUP_NAMES as readonly string[]).includes(expense.category)
        ? (expense.category as ExpenseGroup)
        : "Variable Costs";
      setGroup(g);
      setSubcategory(expense.subcategory ?? EXPENSE_GROUPS[g][0]);
      setDate(expense.date ? new Date(expense.date) : new Date());
      setAddedBy(expense.added_by ?? "");
    }
  }, [expense]);

  const save = async () => {
    if (!expense) return;
    if (!item || !price) return toast.error("Item and price required");
    setSaving(true);
    let caught: any = null;
    try {
      await updateExpenseFn({
        data: {
          expense_id: expense.id,
          item,
          price: Number(price),
          category: group,
          subcategory,
          added_by: addedBy,
          date: format(date, "yyyy-MM-dd"),
        },
      });
    } catch (error: any) {
      caught = error;
    }
    setSaving(false);
    if (caught) return toast.error(caught?.message ?? "Expense update failed");
    toast.success("Expense updated");
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit expense</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full justify-start text-left font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {format(date, "PPP")}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => d && setDate(d)}
                  initialFocus
                  className={cn("p-3 pointer-events-auto")}
                />
              </PopoverContent>
            </Popover>
          </div>
          <div>
            <Label>Item</Label>
            <Input value={item} onChange={(e) => setItem(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Group</Label>
              <Select
                value={group}
                onValueChange={(v) => {
                  const g = v as ExpenseGroup;
                  setGroup(g);
                  setSubcategory(EXPENSE_GROUPS[g][0]);
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GROUP_NAMES.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Subcategory</Label>
              <Select value={subcategory} onValueChange={setSubcategory}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPENSE_GROUPS[group].map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Price (Rs.)</Label>
              <Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} />
            </div>
            <div>
              <Label>Added by</Label>
              <Input value={addedBy} onChange={(e) => setAddedBy(e.target.value)} />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button data-financial-action onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
