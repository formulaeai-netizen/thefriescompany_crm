export function ShimmerBar({ className = "" }: { className?: string }) {
  return <div className={`shimmer rounded-md ${className}`} />;
}

export function StatCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <ShimmerBar className="h-3 w-20" />
        <ShimmerBar className="h-4 w-4 rounded-full" />
      </div>
      <ShimmerBar className="mt-4 h-7 w-28" />
      <ShimmerBar className="mt-3 h-2 w-full" />
    </div>
  );
}

export function StatCardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-6">
      {Array.from({ length: count }).map((_, i) => <StatCardSkeleton key={i} />)}
    </div>
  );
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="w-full space-y-2">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3 rounded-md border border-border bg-card px-3 py-3">
          {Array.from({ length: cols }).map((_, c) => (
            <ShimmerBar key={c} className="h-4 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function CardListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-border bg-card p-4">
          <ShimmerBar className="h-4 w-1/3" />
          <ShimmerBar className="mt-3 h-3 w-2/3" />
          <ShimmerBar className="mt-2 h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}