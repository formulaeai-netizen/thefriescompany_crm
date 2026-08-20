import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuthReady, useIsAdmin, useIsModerator } from "@/lib/roles";
import {
  decideWastageVerification,
  getWastageVerificationImageUrl,
  listWastageVerificationEvents,
  listWastageVerificationsForReview,
  retryWastageVerificationAi,
} from "@/lib/wastage-verifications.functions";

export const Route = createFileRoute("/_authenticated/wastage-verifications")({
  head: () => ({ meta: [{ title: "Wastage Verifications - Fry Guys CRM" }] }),
  component: WastageVerificationsPage,
});

type WastageVerificationRow = {
  id: string;
  daily_production?: { date: string | null } | null;
  staff_entered_weight: number | string;
  staff_entered_unit: string;
  uploaded_by: string;
  expected_wastage_kg_snapshot: number | string;
  ai_result: string | null;
  ai_detected_weight: number | string | null;
  ai_detected_unit: string | null;
  ai_reading_quality: string | null;
  ai_error_code: string | null;
  workflow_status: string;
};

type WastageVerificationEvent = {
  id: string;
  event_type: string;
  previous_status: string | null;
  new_status: string;
  reason: string | null;
  created_at: string;
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function statusTone(status: string) {
  if (status === "pending_ai" || status === "ai_processing")
    return "border-muted-foreground/30 text-muted-foreground";
  if (status === "pending_admin") return "border-warning/30 text-warning";
  if (status === "approved") return "border-success/30 text-success";
  return "border-destructive/30 text-destructive";
}

function aiFailureNeedsManualReview(errorCode: string | null | undefined) {
  return errorCode === "openai_rate_limited" || errorCode === "openai_quota_exceeded";
}

function ReasonDialog({
  trigger,
  title,
  onConfirm,
  pending,
}: {
  trigger: React.ReactNode;
  title: string;
  onConfirm: (reason: string) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState("");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <Input
          placeholder="Reason (required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter>
          <Button
            disabled={!reason.trim() || pending}
            onClick={() => {
              onConfirm(reason.trim());
              setOpen(false);
              setReason("");
            }}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EventHistory({ verificationId }: { verificationId: string }) {
  const listEventsFn = useServerFn(listWastageVerificationEvents);
  const [open, setOpen] = useState(false);
  const eventsQ = useQuery({
    queryKey: ["wastage-verification-events", verificationId],
    queryFn: () => listEventsFn({ data: { verification_id: verificationId } }),
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost">
          History
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Event History</DialogTitle>
        </DialogHeader>
        <div className="max-h-80 space-y-2 overflow-y-auto text-xs">
          {((eventsQ.data?.rows ?? []) as WastageVerificationEvent[]).map((e) => (
            <div key={e.id} className="rounded border border-border p-2">
              <div className="font-medium">{e.event_type}</div>
              <div className="text-muted-foreground">
                {e.previous_status ?? "—"} → {e.new_status}
              </div>
              {e.reason && <div className="text-warning">{e.reason}</div>}
              <div className="text-muted-foreground">{new Date(e.created_at).toLocaleString()}</div>
            </div>
          ))}
          {eventsQ.data?.rows?.length === 0 && <p className="text-muted-foreground">No events.</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ImageViewer({ verificationId }: { verificationId: string }) {
  const getUrlFn = useServerFn(getWastageVerificationImageUrl);
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const open = async () => {
    setLoading(true);
    try {
      const res = await getUrlFn({ data: { verification_id: verificationId } });
      setUrl(res.url);
    } catch (e: unknown) {
      toast.error(getErrorMessage(e, "Could not load image"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      onOpenChange={(o) => {
        if (!o) setUrl(null);
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" onClick={open} disabled={loading}>
          {loading ? "Loading…" : "View Image"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scale Image</DialogTitle>
        </DialogHeader>
        {url ? (
          <img src={url} alt="Weighing scale" className="w-full rounded-md border border-border" />
        ) : (
          <p className="text-sm text-muted-foreground">Loading…</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function WastageVerificationsPage() {
  const qc = useQueryClient();
  const { isAdmin, isLoading: adminLoading } = useIsAdmin();
  const { isModerator, isLoading: modLoading } = useIsModerator();
  const { userId } = useAuthReady();
  const [retryingVerificationId, setRetryingVerificationId] = useState<string | null>(null);
  const canView = isAdmin || isModerator;

  const listFn = useServerFn(listWastageVerificationsForReview);
  const decideFn = useServerFn(decideWastageVerification);
  const retryAiFn = useServerFn(retryWastageVerificationAi);

  const listQ = useQuery({
    queryKey: ["wastage-verifications-review"],
    queryFn: () => listFn({}),
    enabled: canView,
  });

  const decide = useMutation({
    mutationFn: (v: {
      verification_id: string;
      action: "approve" | "reject" | "resubmission";
      reason?: string;
    }) => decideFn({ data: v }),
    onSuccess: () => {
      toast.success("Decision recorded");
      qc.invalidateQueries({ queryKey: ["wastage-verifications-review"] });
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, "Action failed")),
  });

  const retryAi = useMutation({
    mutationFn: (verification_id: string) => retryAiFn({ data: { verification_id } }),
    onMutate: (verification_id) => {
      setRetryingVerificationId(verification_id);
    },
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(`AI retry complete: ${res.ai_result}`);
      } else if (res.reason === "manual_review_required") {
        toast.message("OpenAI is rate-limiting this image. Please review it manually.");
      } else {
        toast.warning("AI retry could not complete");
      }
      qc.invalidateQueries({ queryKey: ["wastage-verifications-review"] });
    },
    onError: (e: unknown) => toast.error(getErrorMessage(e, "AI retry failed")),
    onSettled: () => {
      setRetryingVerificationId(null);
    },
  });

  if (adminLoading || modLoading)
    return <div className="p-6 text-sm text-muted-foreground">Loading access…</div>;
  if (!canView) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-muted-foreground">
          Admin or Moderator access is required.
        </CardContent>
      </Card>
    );
  }

  const rows = (listQ.data?.rows ?? []) as WastageVerificationRow[];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Wastage Verifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Review Staff-submitted scale readings against AI verification. Final approval is
          Admin-only; the existing Wastage % on Daily Production is never changed here.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Review Queue</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="desktop-table overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Production Date</TableHead>
                  <TableHead>Entered</TableHead>
                  <TableHead>AI Result</TableHead>
                  <TableHead>Expected / Actual</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No wastage verifications yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row) => {
                    const isOwnSubmission = row.uploaded_by === userId;
                    const aiFailed = row.ai_result === "failed";
                    const manualReviewAiFailure = aiFailureNeedsManualReview(row.ai_error_code);
                    const canDecide =
                      isAdmin &&
                      !isOwnSubmission &&
                      row.workflow_status === "pending_admin" &&
                      (!aiFailed || manualReviewAiFailure);
                    const isThisRowRetrying = retryingVerificationId === row.id;
                    const isRetryableAiFailure =
                      row.workflow_status === "pending_admin" && aiFailed && !manualReviewAiFailure;
                    const canRetryAi = isAdmin && isRetryableAiFailure && !retryAi.isPending;
                    return (
                      <TableRow key={row.id} className="align-top">
                        <TableCell className="text-xs text-muted-foreground">
                          {row.daily_production?.date
                            ? new Date(row.daily_production.date).toLocaleDateString()
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.staff_entered_weight} {row.staff_entered_unit}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.ai_result ? (
                            <div>
                              <div className="font-medium">{row.ai_result}</div>
                              {row.ai_detected_weight != null && (
                                <div className="text-muted-foreground">
                                  {row.ai_detected_weight} {row.ai_detected_unit} (
                                  {row.ai_reading_quality})
                                </div>
                              )}
                              {manualReviewAiFailure && (
                                <div className="text-muted-foreground">Manual review required</div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {Number(row.expected_wastage_kg_snapshot).toFixed(2)} kg expected
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={statusTone(row.workflow_status)}>
                            {row.workflow_status}
                          </Badge>
                          {isOwnSubmission && (
                            <div className="mt-1 text-[10px] text-muted-foreground">
                              Your submission
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="space-x-1.5 text-right">
                          {isAdmin && <ImageViewer verificationId={row.id} />}
                          <EventHistory verificationId={row.id} />
                          {isAdmin && (
                            <>
                              {isRetryableAiFailure && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!canRetryAi}
                                  onClick={() => retryAi.mutate(row.id)}
                                >
                                  {isThisRowRetrying ? "Retrying..." : "Retry AI"}
                                </Button>
                              )}
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    data-financial-action
                                    size="sm"
                                    disabled={!canDecide || decide.isPending}
                                  >
                                    Approve
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>
                                      Approve this wastage verification?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This finalizes the batch's verified wastage. It does not
                                      change the existing Wastage % on Daily Production.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction
                                      data-financial-action
                                      onClick={() =>
                                        decide.mutate({
                                          verification_id: row.id,
                                          action: "approve",
                                        })
                                      }
                                    >
                                      Approve
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                              <ReasonDialog
                                title="Reject submission"
                                pending={decide.isPending}
                                onConfirm={(reason) =>
                                  decide.mutate({
                                    verification_id: row.id,
                                    action: "reject",
                                    reason,
                                  })
                                }
                                trigger={
                                  <Button size="sm" variant="outline" disabled={!canDecide}>
                                    Reject
                                  </Button>
                                }
                              />
                              <ReasonDialog
                                title="Request resubmission"
                                pending={decide.isPending}
                                onConfirm={(reason) =>
                                  decide.mutate({
                                    verification_id: row.id,
                                    action: "resubmission",
                                    reason,
                                  })
                                }
                                trigger={
                                  <Button size="sm" variant="outline" disabled={!canDecide}>
                                    Resubmit
                                  </Button>
                                }
                              />
                            </>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
          <div className="mobile-card-list">
            {rows.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                No wastage verifications yet.
              </div>
            ) : (
              rows.map((row) => {
                const isOwnSubmission = row.uploaded_by === userId;
                const aiFailed = row.ai_result === "failed";
                const manualReviewAiFailure = aiFailureNeedsManualReview(row.ai_error_code);
                const canDecide =
                  isAdmin &&
                  !isOwnSubmission &&
                  row.workflow_status === "pending_admin" &&
                  (!aiFailed || manualReviewAiFailure);
                const isThisRowRetrying = retryingVerificationId === row.id;
                const isRetryableAiFailure =
                  row.workflow_status === "pending_admin" && aiFailed && !manualReviewAiFailure;
                const canRetryAi = isAdmin && isRetryableAiFailure && !retryAi.isPending;

                return (
                  <div key={row.id} className="mobile-data-card space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold">
                          {row.daily_production?.date
                            ? new Date(row.daily_production.date).toLocaleDateString()
                            : "-"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Entered {row.staff_entered_weight} {row.staff_entered_unit}
                        </div>
                      </div>
                      <Badge variant="outline" className={statusTone(row.workflow_status)}>
                        {row.workflow_status}
                      </Badge>
                    </div>
                    <div className="mobile-data-row">
                      <span>AI Result</span>
                      <span>{row.ai_result ?? "-"}</span>
                    </div>
                    <div className="mobile-data-row">
                      <span>AI Reading</span>
                      <span>
                        {row.ai_detected_weight != null
                          ? `${row.ai_detected_weight} ${row.ai_detected_unit} (${row.ai_reading_quality})`
                          : "-"}
                      </span>
                    </div>
                    <div className="mobile-data-row">
                      <span>Expected</span>
                      <span>{Number(row.expected_wastage_kg_snapshot).toFixed(2)} kg</span>
                    </div>
                    {manualReviewAiFailure && (
                      <div className="rounded-md border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
                        Manual review required
                      </div>
                    )}
                    {isOwnSubmission && (
                      <div className="text-xs text-muted-foreground">Your submission</div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {isAdmin && <ImageViewer verificationId={row.id} />}
                      <EventHistory verificationId={row.id} />
                      {isAdmin && isRetryableAiFailure && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!canRetryAi}
                          onClick={() => retryAi.mutate(row.id)}
                        >
                          {isThisRowRetrying ? "Retrying..." : "Retry AI"}
                        </Button>
                      )}
                      {isAdmin && (
                        <>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                data-financial-action
                                size="sm"
                                disabled={!canDecide || decide.isPending}
                              >
                                Approve
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>
                                  Approve this wastage verification?
                                </AlertDialogTitle>
                                <AlertDialogDescription>
                                  This finalizes the batch&apos;s verified wastage. It does not
                                  change the existing Wastage % on Daily Production.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  data-financial-action
                                  onClick={() =>
                                    decide.mutate({ verification_id: row.id, action: "approve" })
                                  }
                                >
                                  Approve
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                          <ReasonDialog
                            title="Reject submission"
                            pending={decide.isPending}
                            onConfirm={(reason) =>
                              decide.mutate({ verification_id: row.id, action: "reject", reason })
                            }
                            trigger={
                              <Button size="sm" variant="outline" disabled={!canDecide}>
                                Reject
                              </Button>
                            }
                          />
                          <ReasonDialog
                            title="Request resubmission"
                            pending={decide.isPending}
                            onConfirm={(reason) =>
                              decide.mutate({
                                verification_id: row.id,
                                action: "resubmission",
                                reason,
                              })
                            }
                            trigger={
                              <Button size="sm" variant="outline" disabled={!canDecide}>
                                Resubmit
                              </Button>
                            }
                          />
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
