import { Link, useRouterState } from "@tanstack/react-router";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { fetchInvoices, fetchClients, fetchExpenses, fetchInventory } from "@/lib/queries";
import { Moon, Snowflake, Sun } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { isInvoiceReminderEligible } from "@/lib/invoice-reminders";
import { allItems, isActiveNavItem, sectionOrder, type NavItem } from "@/lib/nav-items";
import { useMyRoles } from "@/lib/roles";
const logoSrc = "/logo.png";

type InvoiceBadgeRow = {
  amount?: number | string | null;
  amount_received?: number | string | null;
  payment_status?: string | null;
  due_date?: string | null;
  is_deleted?: boolean | null;
};

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { theme, toggle } = useTheme();
  const { data: roles = [] } = useMyRoles();
  const items = allItems.filter((it) => it.roles.some((r) => roles.includes(r)));
  const qc = useQueryClient();

  // Overdue invoices count for the Invoices badge
  const invoicesQ = useQuery({ queryKey: ["invoices"], queryFn: fetchInvoices });
  const overdueCount = ((invoicesQ.data ?? []) as InvoiceBadgeRow[]).filter((invoice) =>
    isInvoiceReminderEligible(invoice),
  ).length;

  const prefetchers: Record<string, () => void> = {
    "/": () => {
      qc.prefetchQuery({ queryKey: ["invoices"], queryFn: fetchInvoices });
      qc.prefetchQuery({ queryKey: ["clients"], queryFn: fetchClients });
      qc.prefetchQuery({ queryKey: ["expenses"], queryFn: fetchExpenses });
      qc.prefetchQuery({ queryKey: ["inventory"], queryFn: fetchInventory });
    },
    "/invoices": () => qc.prefetchQuery({ queryKey: ["invoices"], queryFn: fetchInvoices }),
    "/clients": () => qc.prefetchQuery({ queryKey: ["clients"], queryFn: fetchClients }),
    "/expenses": () => qc.prefetchQuery({ queryKey: ["expenses"], queryFn: fetchExpenses }),
    "/inventory": () => qc.prefetchQuery({ queryKey: ["inventory"], queryFn: fetchInventory }),
  };

  const grouped = sectionOrder
    .map((section) => ({
      section,
      entries: items.filter((it) => it.section === section),
    }))
    .filter((g) => g.entries.length > 0);

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border bg-sidebar">
      <SidebarHeader>
        <div className="flex items-center justify-center px-3 py-4">
          <img
            src={logoSrc}
            alt="The Fries Company"
            className={
              collapsed ? "h-9 w-9 object-contain" : "h-12 w-auto max-w-full object-contain"
            }
          />
        </div>
      </SidebarHeader>
      <SidebarContent>
        {grouped.map((group) => (
          <SidebarGroup key={group.section}>
            {!collapsed && (
              <SidebarGroupLabel className="px-4 pt-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-white/40">
                {group.section}
              </SidebarGroupLabel>
            )}
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
                {group.entries.map((item) => {
                  const active = isActiveNavItem(pathname, item);
                  const showBadge = item.badgeKey === "overdue" && overdueCount > 0;
                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        className="h-auto rounded-full py-2 text-white/75 transition-colors hover:bg-white/8 hover:text-white data-[active=true]:bg-[color:var(--primary)] data-[active=true]:text-[color:var(--primary-foreground)] data-[active=true]:shadow-[0_6px_20px_-8px_rgba(245,166,35,0.7)]"
                      >
                        <Link
                          to={item.url}
                          onMouseEnter={() => prefetchers[item.url]?.()}
                          onFocus={() => prefetchers[item.url]?.()}
                          className={`flex items-center gap-2.5 px-4 ${item.muted ? "opacity-60" : ""}`}
                        >
                          <item.icon className="h-[17px] w-[17px] shrink-0" />
                          {!collapsed && (
                            <span className="flex flex-1 items-center justify-between gap-2 truncate text-[13px] font-medium">
                              <span className="truncate">{item.title}</span>
                              {showBadge && (
                                <span
                                  aria-label={`${overdueCount} overdue`}
                                  className="tabular inline-flex min-w-[18px] items-center justify-center rounded-md bg-white/15 px-1.5 text-[10px] font-semibold text-white"
                                >
                                  {overdueCount}
                                </span>
                              )}
                            </span>
                          )}
                          {collapsed && showBadge && (
                            <span
                              aria-label={`${overdueCount} overdue`}
                              className="ml-auto h-1.5 w-1.5 rounded-full bg-white"
                            />
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      <SidebarFooter>
        <Button
          variant="ghost"
          size={collapsed ? "icon" : "sm"}
          onClick={toggle}
          className="mx-2 mb-2 justify-start gap-2 rounded-full text-white/75 hover:bg-white/8 hover:text-white"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          {!collapsed && (
            <span className="text-xs">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
          )}
        </Button>
      </SidebarFooter>
    </Sidebar>
  );
}
