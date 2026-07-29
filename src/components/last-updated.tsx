import { useEffect, useState } from "react";

function formatAgo(ms: number) {
  if (ms < 15_000) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) {
    const m = Math.floor(ms / 60_000);
    return `${m} minute${m === 1 ? "" : "s"} ago`;
  }
  const h = Math.floor(ms / 3_600_000);
  return `${h} hour${h === 1 ? "" : "s"} ago`;
}

export function LastUpdated({ timestamp }: { timestamp: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
      </span>
      Last updated: {formatAgo(now - timestamp)}
    </div>
  );
}