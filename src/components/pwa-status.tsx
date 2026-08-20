import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOnlineStatus } from "@/hooks/use-online-status";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

declare global {
  interface WindowEventMap {
    "fryguys:pwa-update": CustomEvent<ServiceWorkerRegistration>;
  }
}

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function PwaStatus() {
  const online = useOnlineStatus();
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showInstallHelp, setShowInstallHelp] = useState(false);
  const [waitingRegistration, setWaitingRegistration] = useState<ServiceWorkerRegistration | null>(
    null,
  );

  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      if (!isStandalone()) setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const appInstalled = () => {
      setInstallPrompt(null);
      toast.success("Fry Guys CRM installed");
    };
    const updateAvailable = (event: WindowEventMap["fryguys:pwa-update"]) => {
      setWaitingRegistration(event.detail);
    };

    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", appInstalled);
    window.addEventListener("fryguys:pwa-update", updateAvailable);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", appInstalled);
      window.removeEventListener("fryguys:pwa-update", updateAvailable);
    };
  }, []);

  useEffect(() => {
    const blockOfflineFinancialAction = (event: Event) => {
      if (online) return;
      const target = event.target instanceof Element ? event.target : null;
      const action = target?.closest("[data-financial-action]");
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      toast.error("Internet connection required for this action.");
    };

    document.addEventListener("click", blockOfflineFinancialAction, true);
    document.addEventListener("submit", blockOfflineFinancialAction, true);
    return () => {
      document.removeEventListener("click", blockOfflineFinancialAction, true);
      document.removeEventListener("submit", blockOfflineFinancialAction, true);
    };
  }, [online]);

  const install = async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome !== "accepted") setInstallPrompt(null);
      return;
    }
    if (isIos()) setShowInstallHelp((value) => !value);
  };

  const update = () => {
    const waiting = waitingRegistration?.waiting;
    if (!waiting) {
      window.location.reload();
      return;
    }
    waiting.postMessage({ type: "SKIP_WAITING" });
    window.location.reload();
  };

  if (isStandalone() && online && !waitingRegistration) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(72px+env(safe-area-inset-bottom))] z-40 space-y-2 md:bottom-4 md:left-auto md:right-4 md:w-[360px]">
      {!online && (
        <div className="rounded-md border border-warning/40 bg-background/95 p-3 text-sm shadow-lg backdrop-blur">
          <div className="flex items-start gap-2">
            <WifiOff className="mt-0.5 h-4 w-4 text-warning" />
            <div>
              <div className="font-medium">You&apos;re offline.</div>
              <div className="text-xs text-muted-foreground">
                Reconnect to continue working with live business data.
              </div>
            </div>
          </div>
        </div>
      )}

      {waitingRegistration && (
        <div className="rounded-md border border-primary/40 bg-background/95 p-3 text-sm shadow-lg backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">New version available</div>
              <div className="text-xs text-muted-foreground">
                Update when your current form is safe.
              </div>
            </div>
            <Button size="sm" onClick={update}>
              <RefreshCw className="h-4 w-4" />
              Update
            </Button>
          </div>
        </div>
      )}

      {!isStandalone() && (installPrompt || isIos()) && (
        <div className="rounded-md border border-border bg-background/95 p-3 text-sm shadow-lg backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-medium">Install Fry Guys CRM</div>
              {showInstallHelp && (
                <div className="mt-1 text-xs text-muted-foreground">
                  On iPhone/iPad use Share, then Add to Home Screen.
                </div>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={install}>
              <Download className="h-4 w-4" />
              Install
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
