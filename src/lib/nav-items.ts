import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Banknote,
  BarChart3,
  BellRing,
  BrainCircuit,
  CheckCircle2,
  ClipboardList,
  ClipboardCheck,
  CalendarDays,
  Factory,
  FileText,
  HandCoins,
  LayoutDashboard,
  LineChart,
  ListOrdered,
  MessageSquare,
  NotebookText,
  Package,
  Receipt,
  Scale,
  Settings as SettingsIcon,
  Trash2,
  TrendingUp,
  Route,
  Undo2,
  Users,
  Wallet,
} from "lucide-react";
import type { AppRole } from "@/lib/roles";

export type NavItem = {
  title: string;
  url: string;
  icon: LucideIcon;
  roles: AppRole[];
  muted?: boolean;
  section: "Overview" | "Operations" | "Finance" | "Signals";
  badgeKey?: "overdue";
};

export const allItems: NavItem[] = [
  { section: "Overview", title: "Dashboard", url: "/", icon: LayoutDashboard, roles: ["admin"] },
  { section: "Overview", title: "Clients & Leads", url: "/clients", icon: Users, roles: ["admin"] },
  {
    section: "Overview",
    title: "My Dashboard",
    url: "/investor",
    icon: Wallet,
    roles: ["investor"],
  },
  {
    section: "Operations",
    title: "Inventory",
    url: "/inventory",
    icon: Package,
    roles: ["admin", "staff"],
  },
  {
    section: "Operations",
    title: "Sales Orders",
    url: "/orders",
    icon: ListOrdered,
    roles: ["admin", "moderator"],
  },
  {
    section: "Operations",
    title: "Today",
    url: "/today",
    icon: CalendarDays,
    roles: ["admin", "moderator"],
  },
  {
    section: "Signals",
    title: "Sales Leads",
    url: "/sales-leads",
    icon: Users,
    roles: ["admin", "moderator"],
  },
  { section: "Signals", title: "Investor Leads", url: "/investor-leads", icon: TrendingUp, roles: ["admin"] },
  {
    section: "Signals",
    title: "Employee Performance",
    url: "/employee-performance",
    icon: BarChart3,
    roles: ["admin", "moderator"],
  },
  {
    section: "Operations",
    title: "Daily Production",
    url: "/production",
    icon: Factory,
    roles: ["admin", "staff"],
  },
  {
    section: "Operations",
    title: "Production Planning",
    url: "/production-planning",
    icon: ClipboardList,
    roles: ["admin", "moderator"],
  },
  {
    section: "Operations",
    title: "Allocation & Delivery Plan",
    url: "/allocation-delivery-plan",
    icon: Route,
    roles: ["admin", "moderator"],
  },
  {
    section: "Operations",
    title: "Wastage Verifications",
    url: "/wastage-verifications",
    icon: Scale,
    roles: ["admin", "moderator"],
  },
  {
    section: "Operations",
    title: "Stock Audits",
    url: "/stock-audits",
    icon: ClipboardCheck,
    roles: ["admin", "staff", "moderator"],
  },
  {
    section: "Finance",
    title: "Invoices",
    url: "/invoices",
    icon: FileText,
    roles: ["admin", "staff"],
    badgeKey: "overdue",
  },
  {
    section: "Finance",
    title: "Customer Ledger",
    url: "/customer-ledger",
    icon: NotebookText,
    roles: ["admin"],
  },
  {
    section: "Finance",
    title: "Deleted Invoices",
    url: "/invoices/deleted",
    icon: Trash2,
    muted: true,
    roles: ["admin"],
  },
  { section: "Finance", title: "Returns", url: "/returns", icon: Undo2, roles: ["admin", "staff"] },
  {
    section: "Finance",
    title: "Expenses",
    url: "/expenses",
    icon: Receipt,
    roles: ["admin", "staff"],
  },
  { section: "Finance", title: "P&L", url: "/pnl", icon: LineChart, roles: ["admin"] },
  { section: "Finance", title: "Investors", url: "/investors", icon: TrendingUp, roles: ["admin"] },
  { section: "Finance", title: "Salaries", url: "/salaries", icon: Banknote, roles: ["admin"] },
  {
    section: "Finance",
    title: "Credit Inventory Purchases",
    url: "/credit-inventory-purchases",
    icon: HandCoins,
    roles: ["admin", "staff", "moderator"],
  },
  {
    section: "Signals",
    title: "Customer Analytics",
    url: "/customer-analytics",
    icon: BarChart3,
    roles: ["admin"],
  },
  {
    section: "Signals",
    title: "WhatsApp Logs",
    url: "/whatsapp-logs",
    icon: MessageSquare,
    roles: ["admin"],
  },
  {
    section: "Signals",
    title: "Payment Reminders",
    url: "/payment-reminders",
    icon: BellRing,
    roles: ["admin"],
  },
  {
    section: "Signals",
    title: "Payment Verifications",
    url: "/payment-verifications",
    icon: CheckCircle2,
    roles: ["admin"],
  },
  {
    section: "Signals",
    title: "Operational Alerts",
    url: "/operational-alerts",
    icon: AlertTriangle,
    roles: ["admin", "moderator"],
  },
  {
    section: "Signals",
    title: "AI Watchdog",
    url: "/ai-watchdog",
    icon: BrainCircuit,
    roles: ["admin", "staff", "moderator"],
  },
  { section: "Signals", title: "Settings", url: "/settings", icon: SettingsIcon, roles: ["admin"] },
];

export const sectionOrder: NavItem["section"][] = ["Overview", "Operations", "Finance", "Signals"];

export function isActiveNavItem(pathname: string, item: Pick<NavItem, "url">) {
  return item.url === "/"
    ? pathname === "/"
    : item.url === "/invoices"
      ? pathname === "/invoices" ||
        (pathname.startsWith("/invoices") && pathname !== "/invoices/deleted")
      : pathname === item.url || pathname.startsWith(item.url + "/");
}
