import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuthReady } from "@/lib/roles";
import { calculateExpectedWastageKg } from "@/lib/wastage-verifications";
import {
  submitWastageVerification,
  processWastageVerificationAi,
} from "@/lib/wastage-verifications.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Scale } from "lucide-react";

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 8 * 1024 * 1024;
const MAX_AI_IMAGE_DIMENSION_PX = 1400;
const AI_IMAGE_JPEG_QUALITY = 0.82;

type ProductionRow = {
  id: string;
  date: string;
  raw_input_kg: number;
  wastage_percent: number;
};

type LatestVerification = {
  id: string;
  workflow_status: string;
  ai_result: string | null;
  ai_reading_quality: string | null;
  admin_decision_reason: string | null;
  staff_entered_weight: number;
  staff_entered_unit: string;
  created_at: string;
};

async function fetchLatestVerification(
  dailyProductionId: string,
): Promise<LatestVerification | null> {
  const { data, error } = await supabase
    .from("wastage_verifications")
    .select(
      "id, workflow_status, ai_result, ai_reading_quality, admin_decision_reason, staff_entered_weight, staff_entered_unit, created_at",
    )
    .eq("daily_production_id", dailyProductionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as LatestVerification | null) ?? null;
}

const ACTIVE_STATUSES = new Set(["pending_ai", "ai_processing", "pending_admin", "approved"]);

function statusLabel(v: LatestVerification): { label: string; className: string } {
  switch (v.workflow_status) {
    case "pending_ai":
      return { label: "Pending AI", className: "bg-muted text-muted-foreground" };
    case "ai_processing":
      return { label: "AI Processing…", className: "bg-warning/15 text-warning border-warning/30" };
    case "pending_admin":
      return {
        label: "Pending Admin Review",
        className: "bg-warning/15 text-warning border-warning/30",
      };
    case "approved":
      return { label: "Approved", className: "bg-success/15 text-success border-success/30" };
    case "rejected":
      return {
        label: "Rejected",
        className: "bg-destructive/15 text-destructive border-destructive/30",
      };
    case "resubmission_required":
      return {
        label: "Resubmission Required",
        className: "bg-destructive/15 text-destructive border-destructive/30",
      };
    default:
      return { label: v.workflow_status, className: "bg-muted text-muted-foreground" };
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Could not prepare image"));
      },
      type,
      quality,
    );
  });
}

async function prepareImageForAi(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();

    const scale = Math.min(1, MAX_AI_IMAGE_DIMENSION_PX / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare image");
    ctx.drawImage(image, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, "image/jpeg", AI_IMAGE_JPEG_QUALITY);
    const baseName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_.-]/g, "_");
    return new File([blob], `${baseName || "wastage-scale"}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function WastageVerificationDialog({ row }: { row: ProductionRow }) {
  const qc = useQueryClient();
  const { userId } = useAuthReady();
  const submitFn = useServerFn(submitWastageVerification);
  const processFn = useServerFn(processWastageVerificationAi);

  const [open, setOpen] = useState(false);
  const [weight, setWeight] = useState("");
  const [unit, setUnit] = useState<"kg" | "g">("kg");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const latestQ = useQuery({
    queryKey: ["wastage-verification-latest", row.id],
    queryFn: () => fetchLatestVerification(row.id),
    enabled: open,
  });

  const expectedKg = calculateExpectedWastageKg(
    Number(row.raw_input_kg),
    Number(row.wastage_percent),
  );
  const latest = latestQ.data ?? null;
  const hasActive = latest ? ACTIVE_STATUSES.has(latest.workflow_status) : false;

  const onFileChange = (f: File | null) => {
    if (!f) return setFile(null);
    if (!ALLOWED_MIME_TYPES.includes(f.type)) {
      toast.error("Only JPEG, PNG or WebP images are allowed");
      return;
    }
    if (f.size > MAX_FILE_SIZE_BYTES) {
      toast.error("Image must be 8 MB or smaller");
      return;
    }
    setFile(f);
  };

  const submit = async () => {
    const w = Number(weight);
    if (!weight || !(w > 0)) return toast.error("Enter a positive measured weight");
    if (!file) return toast.error("Select a photo of the weighing scale");
    if (!userId) return toast.error("Not authenticated");

    setSubmitting(true);
    try {
      const uploadFile = await prepareImageForAi(file);
      const safeName = uploadFile.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
      const path = `${userId}/${crypto.randomUUID()}/${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("wastage-scale-images")
        .upload(path, uploadFile, { contentType: uploadFile.type, upsert: false });
      if (uploadError) throw uploadError;

      const { verification_id } = await submitFn({
        data: {
          daily_production_id: row.id,
          staff_entered_weight: w,
          staff_entered_unit: unit,
          image_storage_path: path,
        },
      });

      toast.success("Wastage proof submitted — starting AI check…");
      qc.invalidateQueries({ queryKey: ["wastage-verification-latest", row.id] });

      const result = await processFn({ data: { verification_id } });
      if (!result.ok && result.reason === "configuration_missing") {
        toast.message(
          "Submitted. AI verification is not configured yet — an Admin will review manually.",
        );
      } else if (!result.ok) {
        toast.message("Submitted. AI check could not complete — an Admin will review manually.");
      } else {
        toast.success("AI check complete — awaiting Admin approval.");
      }
      qc.invalidateQueries({ queryKey: ["wastage-verification-latest", row.id] });
      setWeight("");
      setFile(null);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Submission failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5">
          <Scale className="h-3.5 w-3.5" />
          Wastage Proof
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Wastage Verification</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
            <div>
              <span className="text-muted-foreground">Raw Input:</span> {row.raw_input_kg} kg
            </div>
            <div>
              <span className="text-muted-foreground">Saved Wastage %:</span> {row.wastage_percent}%
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">Expected Wastage:</span>{" "}
              {expectedKg.toFixed(2)} kg
            </div>
          </div>

          {latestQ.isLoading && <p className="text-muted-foreground">Loading status…</p>}

          {latest && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Latest submission</span>
                <Badge variant="outline" className={statusLabel(latest).className}>
                  {statusLabel(latest).label}
                </Badge>
              </div>
              <div className="text-xs text-muted-foreground">
                Entered: {latest.staff_entered_weight} {latest.staff_entered_unit}
                {latest.ai_result && ` · AI: ${latest.ai_result}`}
              </div>
              {latest.admin_decision_reason && (
                <div className="rounded bg-warning/10 p-2 text-xs text-warning">
                  {latest.admin_decision_reason}
                </div>
              )}
            </div>
          )}

          {!hasActive && (
            <div className="space-y-3 border-t border-border pt-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label>Actual Weight</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={weight}
                    onChange={(e) => setWeight(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Unit</Label>
                  <Select value={unit} onValueChange={(v) => setUnit(v as "kg" | "g")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="kg">kg</SelectItem>
                      <SelectItem value="g">g</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label>Scale Photo (JPEG/PNG/WebP, max 8 MB)</Label>
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
                />
                {file && <p className="mt-1 text-xs text-muted-foreground">{file.name}</p>}
              </div>
            </div>
          )}
        </div>

        {!hasActive && (
          <DialogFooter>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit Wastage Proof"}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
