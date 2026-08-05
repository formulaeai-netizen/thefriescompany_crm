import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  listWhatsAppRoutingNumbers,
  setWhatsAppRoutingNumber,
} from "@/lib/whatsapp-routing.functions";
import {
  WHATSAPP_ROUTING_FLOW_KEYS,
  WHATSAPP_ROUTING_FLOW_LABELS,
  type WhatsAppRoutingFlowKey,
} from "@/lib/whatsapp-routing";

function FlowRow({
  flowKey,
  currentNumber,
}: {
  flowKey: WhatsAppRoutingFlowKey;
  currentNumber: string | null;
}) {
  const qc = useQueryClient();
  const setFn = useServerFn(setWhatsAppRoutingNumber);
  const [value, setValue] = useState(currentNumber ?? "");
  const [error, setError] = useState<string | null>(null);

  const mut = useMutation({
    mutationFn: () => setFn({ data: { flow_key: flowKey, recipient_phone: value } }),
    onSuccess: () => {
      toast.success(`${WHATSAPP_ROUTING_FLOW_LABELS[flowKey]} number saved`);
      setError(null);
      qc.invalidateQueries({ queryKey: ["whatsapp-routing-numbers"] });
    },
    onError: (e: any) => {
      const message = e?.message ?? "Could not save number";
      setError(message);
      toast.error(message);
    },
  });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="flex-1">
        <Label className="text-xs">{WHATSAPP_ROUTING_FLOW_LABELS[flowKey]}</Label>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="03XXXXXXXXX or +923XXXXXXXXX"
          className="mt-1"
        />
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        {currentNumber && (
          <p className="mt-1 text-xs text-muted-foreground">
            Current: {currentNumber.slice(0, 4)}*******{currentNumber.slice(-2)}
          </p>
        )}
      </div>
      <Button size="sm" disabled={!value.trim() || mut.isPending} onClick={() => mut.mutate()}>
        Save
      </Button>
    </div>
  );
}

export function WhatsAppRoutingSettings() {
  const listFn = useServerFn(listWhatsAppRoutingNumbers);
  const listQ = useQuery({ queryKey: ["whatsapp-routing-numbers"], queryFn: () => listFn({}) });

  const rows = listQ.data?.rows ?? [];
  const numberFor = (flowKey: WhatsAppRoutingFlowKey) =>
    rows.find((r: any) => r.flow_key === flowKey)?.recipient_phone_normalized ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">WhatsApp Routing (whatsapp-web worker)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Invoice payment reminders go directly to each client's own WhatsApp number and are not
          configured here.
        </p>

        {listQ.isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : listQ.isError ? (
          <div className="text-sm text-destructive">Could not load WhatsApp routing numbers.</div>
        ) : (
          <div className="space-y-2">
            {WHATSAPP_ROUTING_FLOW_KEYS.map((flowKey) => (
              <FlowRow key={flowKey} flowKey={flowKey} currentNumber={numberFor(flowKey)} />
            ))}
          </div>
        )}

        <div className="rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
          WhatsApp worker/sending is currently controlled separately and changing a number does not
          enable live sending.
        </div>
      </CardContent>
    </Card>
  );
}
