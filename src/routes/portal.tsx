import { createFileRoute, Outlet, Link } from "@tanstack/react-router";
import { LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/portal")({ component: PortalLayout });
function PortalLayout() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b px-4">
        <Link to="/portal" className="font-semibold">
          The Fries Company
        </Link>
        <button aria-label="Sign out" onClick={() => void supabase.auth.signOut()}>
          <LogOut className="h-5 w-5" />
        </button>
      </header>
      <main className="mx-auto max-w-2xl p-4 pb-20">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 flex justify-around border-t bg-background p-3 text-sm">
        <Link to="/portal">Home</Link>
        <Link to="/portal/orders">Orders</Link>
        <Link to="/portal/ledger">Ledger</Link>
      </nav>
    </div>
  );
}
