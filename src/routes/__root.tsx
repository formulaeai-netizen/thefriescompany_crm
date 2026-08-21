import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  useNavigate,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Moon, Sun, LogOut, Loader2, Command as CommandIcon } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useQueryClient } from "@tanstack/react-query";
import { useMyRoles, allowedRolesFor, homeForRoles } from "@/lib/roles";
import { toast } from "sonner";
import { CommandPalette, useCommandPalette } from "@/components/command-palette";
import { registerPWA } from "@/lib/pwa-register";
import { MobileBottomNav } from "@/components/mobile-bottom-nav";
import { PwaStatus } from "@/components/pwa-status";
import { NotificationCenter } from "@/components/notification-center";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Fry Guys CRM" },
      {
        name: "description",
        content: "B2B food-ingredients CRM, invoicing & autonomous payment reminders.",
      },
      { property: "og:title", content: "Fry Guys CRM" },
      {
        property: "og:description",
        content: "B2B food-ingredients CRM, invoicing & autonomous payment reminders.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:title", content: "Fry Guys CRM" },
      {
        name: "twitter:description",
        content: "B2B food-ingredients CRM, invoicing & autonomous payment reminders.",
      },
      {
        property: "og:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/5eb04d37-25bd-47bd-a655-d6ee438a5f25/id-preview-9f73cb20--e83fe006-3627-4b64-95c1-17e4edee1a51.lovable.app-1781630119887.png",
      },
      {
        name: "twitter:image",
        content:
          "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/5eb04d37-25bd-47bd-a655-d6ee438a5f25/id-preview-9f73cb20--e83fe006-3627-4b64-95c1-17e4edee1a51.lovable.app-1781630119887.png",
      },
      { name: "theme-color", content: "#12151F" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Fry Guys" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", type: "image/png", href: "/logo.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/pwa-192.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600;700&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    registerPWA();
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => data.subscription.unsubscribe();
  }, [router, queryClient]);

  if (pathname === "/auth" || pathname.startsWith("/portal")) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <Outlet />
          <Toaster richColors position="top-right" />
        </ThemeProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RoleGuard>
          <SidebarProvider>
            <div className="flex min-h-screen w-full bg-background text-foreground">
              <div className="hidden md:block">
                <AppSidebar />
              </div>
              <div className="flex flex-1 flex-col min-w-0">
                <TopBar />
                <main className="flex-1 px-3 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:py-6 lg:px-10 lg:py-8 min-w-0 overflow-x-hidden">
                  <div key={pathname} className="page-transition">
                    <Outlet />
                  </div>
                </main>
              </div>
            </div>
            <Toaster richColors position="top-right" />
            <GlobalCommandPalette />
            <PwaStatus />
            <MobileBottomNav />
          </SidebarProvider>
        </RoleGuard>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

function GlobalCommandPalette() {
  const { open, setOpen } = useCommandPalette();
  return <CommandPalette open={open} onOpenChange={setOpen} />;
}

function RoleGuard({ children }: { children: ReactNode }) {
  const location = useRouterState({ select: (s) => s.location });
  const pathname = location.pathname;
  const navigate = useNavigate();
  const { data: roles, isLoading, isReady, hasSession, isError } = useMyRoles();

  useEffect(() => {
    if (!isReady) return;
    if (pathname === "/auth") return;
    if (!hasSession) {
      navigate({ to: "/auth", search: { redirect: location.href }, replace: true });
      return;
    }
    if (isLoading) return;
    if (isError) {
      toast.error("Could not load your permissions. Please retry.");
      return;
    }
    if (!roles || roles.length === 0) {
      toast.error("Access denied — no role assigned");
      navigate({ to: "/auth", replace: true });
      return;
    }
    const allowed = allowedRolesFor(pathname);
    if (!roles.some((r) => allowed.includes(r))) {
      toast.error("Access denied");
      navigate({ to: homeForRoles(roles), replace: true });
    }
  }, [roles, isLoading, isReady, hasSession, isError, pathname, location.href, navigate]);

  // Block protected content until session + roles are known.
  if (!isReady || (hasSession && isLoading)) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-[#F59E0B]" />
      </div>
    );
  }
  if (pathname.startsWith("/portal")) return <>{children}</>;
  if (roles?.includes("customer")) return null;
  return <>{children}</>;
}

function TopBar() {
  const { theme, toggle } = useTheme();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { title, subtitle } = pageMeta(pathname);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setOpen: setCmdOpen } = useCommandPalette();
  const signOut = async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  return (
    <header className="sticky top-0 z-30 flex min-h-[56px] items-center justify-between border-b border-border bg-background/95 px-3 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur sm:min-h-[64px] sm:px-4 sm:py-3 lg:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <SidebarTrigger className="-ml-1 hidden shrink-0 md:inline-flex" />
        <div className="min-w-0">
          <h1 className="font-display truncate text-lg font-medium leading-tight text-foreground sm:text-xl">
            {title}
          </h1>
          {subtitle && (
            <p className="mt-0.5 hidden truncate text-xs text-muted-foreground sm:block">
              {subtitle}
            </p>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
        <button
          type="button"
          onClick={() => setCmdOpen(true)}
          aria-label="Open command palette"
          className="hidden md:inline-flex items-center gap-1.5 rounded-[9px] border border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:border-primary/40"
        >
          <CommandIcon className="h-3 w-3" /> K
        </button>
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
          {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <NotificationCenter />
        <Button variant="ghost" size="icon" onClick={signOut} aria-label="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
        <img
          src="/logo.png"
          alt="The Fries Company"
          className="ml-0.5 h-7 w-7 rounded-full object-contain sm:ml-2 sm:h-9 sm:w-9"
        />
      </div>
    </header>
  );
}

function pageMeta(pathname: string): { title: string; subtitle?: string } {
  if (pathname === "/")
    return { title: "Dashboard", subtitle: "Live overview of revenue, collections and signals" };
  const map: Record<string, { title: string; subtitle: string }> = {
    "/clients": { title: "Clients & Leads", subtitle: "Accounts, contacts and pipeline" },
    "/orders": { title: "Sales Orders", subtitle: "Confirmed demand and planning foundation" },
    "/inventory": { title: "Inventory", subtitle: "Stock levels and reorder points" },
    "/invoices/deleted": { title: "Deleted Invoices", subtitle: "Soft-deleted archive" },
    "/invoices": { title: "Invoices", subtitle: "Billing, collections and status" },
    "/customer-ledger": {
      title: "Customer Ledger",
      subtitle: "Branch-wise stock, invoices and receivables",
    },
    "/production": { title: "Daily Production", subtitle: "Raw input, output and variance" },
    "/expenses": { title: "Expenses", subtitle: "Costs by category and period" },
    "/pnl": { title: "Profit & Loss", subtitle: "Monthly performance & margin" },
    "/investors": { title: "Investors", subtitle: "Cap table and distributions" },
    "/investor": { title: "My Dashboard", subtitle: "Your positions and returns" },
    "/salaries": { title: "Salaries", subtitle: "Monthly payroll sheet" },
    "/whatsapp-logs": { title: "WhatsApp Logs", subtitle: "Outbound message history" },
    "/customer-analytics": {
      title: "Customer Analytics",
      subtitle: "Cohorts, revenue and reorder cadence",
    },
    "/settings": { title: "Settings", subtitle: "Preferences and integrations" },
    "/trust": { title: "Trust & Security", subtitle: "Compliance and controls" },
  };
  const key = Object.keys(map)
    .sort((a, b) => b.length - a.length)
    .find((k) => pathname.startsWith(k));
  return key ? map[key] : { title: "Fry Guys" };
}
