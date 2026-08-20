import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { fetchClients, fetchInvoices } from "@/lib/queries";
import {
  LayoutDashboard,
  Users,
  FileText,
  Receipt,
  Package,
  Factory,
  LineChart,
  TrendingUp,
  Banknote,
  MessageSquare,
  BarChart3,
  Settings as SettingsIcon,
  PlusCircle,
} from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
};

const NAV = [
  { label: "Go to Dashboard", to: "/", icon: LayoutDashboard },
  { label: "Go to Clients & Leads", to: "/clients", icon: Users },
  { label: "Go to Inventory", to: "/inventory", icon: Package },
  { label: "Go to Daily Production", to: "/production", icon: Factory },
  { label: "Go to Invoices", to: "/invoices", icon: FileText },
  { label: "Go to Expenses", to: "/expenses", icon: Receipt },
  { label: "Go to P&L", to: "/pnl", icon: LineChart },
  { label: "Go to Investors", to: "/investors", icon: TrendingUp },
  { label: "Go to Salaries", to: "/salaries", icon: Banknote },
  { label: "Go to Customer Analytics", to: "/customer-analytics", icon: BarChart3 },
  { label: "Go to WhatsApp Logs", to: "/whatsapp-logs", icon: MessageSquare },
  { label: "Go to Settings", to: "/settings", icon: SettingsIcon },
] as const;

export function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");

  const clientsQ = useQuery({
    queryKey: ["clients"],
    queryFn: fetchClients,
    enabled: open,
  });
  const invoicesQ = useQuery({
    queryKey: ["invoices"],
    queryFn: fetchInvoices,
    enabled: open,
  });

  const clients = (clientsQ.data ?? []) as any[];
  const invoices = (invoicesQ.data ?? []) as any[];

  const filteredClients = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return clients.slice(0, 6);
    return clients.filter((c) => (c.legal_name ?? "").toLowerCase().includes(q)).slice(0, 8);
  }, [clients, query]);

  const filteredInvoices = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return [];
    return invoices
      .filter((i) =>
        String(i.invoice_number ?? "")
          .toLowerCase()
          .includes(q),
      )
      .slice(0, 8);
  }, [invoices, query]);

  const go = (fn: () => void) => {
    onOpenChange(false);
    setQuery("");
    setTimeout(fn, 60);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search or type a command…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Quick actions">
          <CommandItem onSelect={() => go(() => navigate({ to: "/invoices" }))}>
            <PlusCircle className="text-primary" /> New Invoice
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/expenses" }))}>
            <PlusCircle className="text-primary" /> Add Expense
          </CommandItem>
          <CommandItem onSelect={() => go(() => navigate({ to: "/clients" }))}>
            <PlusCircle className="text-primary" /> Add Client
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Navigation">
          {NAV.map((n) => (
            <CommandItem key={n.to} onSelect={() => go(() => navigate({ to: n.to }))}>
              <n.icon /> {n.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {filteredClients.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Clients">
              {filteredClients.map((c) => (
                <CommandItem key={c.id} onSelect={() => go(() => navigate({ to: "/clients" }))}>
                  <Users /> {c.legal_name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        {filteredInvoices.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Invoices">
              {filteredInvoices.map((i) => (
                <CommandItem key={i.id} onSelect={() => go(() => navigate({ to: "/invoices" }))}>
                  <FileText /> {i.invoice_number ?? "(no number)"} — {i.clients?.legal_name ?? ""}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
      </CommandList>
    </CommandDialog>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return { open, setOpen };
}
