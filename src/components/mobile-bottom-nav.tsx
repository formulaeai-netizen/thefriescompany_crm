import { Link, useRouterState } from "@tanstack/react-router";
import { AlertTriangle, Home, MoreHorizontal, Package, Receipt } from "lucide-react";
import { useState } from "react";
import { allItems, isActiveNavItem, type NavItem } from "@/lib/nav-items";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useMyRoles } from "@/lib/roles";

const directTabs = [
  { label: "Home", url: "/", icon: Home, match: ["/"] },
  {
    label: "Finance",
    url: "/invoices",
    icon: Receipt,
    match: [
      "/invoices",
      "/expenses",
      "/customer-ledger",
      "/salaries",
      "/credit-inventory-purchases",
    ],
  },
  {
    label: "Inventory",
    url: "/inventory",
    icon: Package,
    match: ["/inventory", "/production", "/stock-audits"],
  },
  {
    label: "Alerts",
    url: "/operational-alerts",
    icon: AlertTriangle,
    match: [
      "/operational-alerts",
      "/payment-verifications",
      "/payment-reminders",
      "/wastage-verifications",
    ],
  },
];

function firstAllowed(preferred: string, items: NavItem[]) {
  if (items.some((item) => item.url === preferred)) return preferred;
  if (preferred === "/") return items[0]?.url ?? "/";
  if (preferred === "/invoices") {
    return (
      items.find((item) => item.section === "Finance")?.url ??
      items.find((item) => item.url === "/inventory")?.url ??
      items[0]?.url ??
      "/"
    );
  }
  if (preferred === "/operational-alerts") {
    return (
      items.find((item) => item.url === "/operational-alerts")?.url ??
      items.find((item) => item.url === "/wastage-verifications")?.url ??
      items.find((item) => item.url === "/payment-verifications")?.url ??
      items[0]?.url ??
      "/"
    );
  }
  return items.find((item) => item.url === preferred)?.url ?? items[0]?.url ?? "/";
}

export function MobileBottomNav() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { data: roles = [] } = useMyRoles();
  const [open, setOpen] = useState(false);
  const items = allItems.filter((item) => item.roles.some((role) => roles.includes(role)));
  const visibleTabs = directTabs
    .map((tab) => ({ ...tab, url: firstAllowed(tab.url, items) }))
    .filter(
      (tab, index, list) =>
        tab.url && list.findIndex((candidate) => candidate.url === tab.url) === index,
    )
    .slice(0, 4);

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] pt-2 shadow-[0_-12px_30px_-22px_rgba(0,0,0,0.8)] backdrop-blur md:hidden">
      <div className="grid grid-cols-5 gap-1">
        {visibleTabs.map((tab) => {
          const active = tab.match.some((match) =>
            match === "/"
              ? pathname === "/"
              : pathname === match || pathname.startsWith(match + "/"),
          );
          return (
            <Link
              key={tab.label}
              to={tab.url}
              className={`flex min-h-12 flex-col items-center justify-center rounded-md px-1 text-[11px] font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <tab.icon className="h-4 w-4" />
              <span className="mt-1 truncate">{tab.label}</span>
            </Link>
          );
        })}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              className={`flex min-h-12 flex-col items-center justify-center rounded-md px-1 text-[11px] font-medium transition-colors ${
                visibleTabs.some((tab) => tab.url === pathname)
                  ? "text-muted-foreground hover:bg-muted hover:text-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              <MoreHorizontal className="h-4 w-4" />
              <span className="mt-1">More</span>
            </button>
          </SheetTrigger>
          <SheetContent
            side="bottom"
            className="max-h-[82vh] rounded-t-xl px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-5"
          >
            <SheetHeader className="text-left">
              <SheetTitle>More</SheetTitle>
            </SheetHeader>
            <div className="mt-4 grid grid-cols-2 gap-2 overflow-y-auto pb-2">
              {items.map((item) => {
                const active = isActiveNavItem(pathname, item);
                return (
                  <Link
                    key={item.url}
                    to={item.url}
                    onClick={() => setOpen(false)}
                    className={`flex min-h-12 items-center gap-3 rounded-md border px-3 text-sm ${
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-card text-foreground"
                    }`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" />
                    <span className="truncate">{item.title}</span>
                  </Link>
                );
              })}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
