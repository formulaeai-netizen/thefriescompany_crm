import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSettings } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UsersManagement } from "@/components/users-management";
import { OpeningBalanceSettings } from "@/components/opening-balance-settings";
import { WhatsAppRoutingSettings } from "@/components/whatsapp-routing-settings";
import { useIsAdmin } from "@/lib/roles";

const PUBLIC_SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;

function getSupabaseFunctionUrl(functionName: string) {
  if (!PUBLIC_SUPABASE_URL) return "";
  try {
    const supabaseUrl = new URL(PUBLIC_SUPABASE_URL);
    if (supabaseUrl.protocol !== "https:" || !supabaseUrl.hostname.endsWith(".supabase.co")) {
      return "";
    }
    return `${supabaseUrl.origin}/functions/v1/${functionName}`;
  } catch {
    return "";
  }
}

const META_WEBHOOK_URL = getSupabaseFunctionUrl("whatsapp-incoming-webhook");

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings - TFC CRM" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const [form, setForm] = useState<any>({});
  const { isAdmin } = useIsAdmin();

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const save = async () => {
    if (!form.id) return toast.error("Settings row not loaded yet");
    const { id, created_at, updated_at, ...rest } = form;
    const { error } = await supabase
      .from("settings")
      .update({ ...rest, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Settings saved");
    qc.invalidateQueries({ queryKey: ["settings"] });
  };

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure WhatsApp, Email and autonomous agent behavior.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">WhatsApp (Meta Cloud API)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Meta Phone Number ID">
            <Input
              value={form.meta_phone_number_id ?? ""}
              onChange={(e) => set("meta_phone_number_id", e.target.value)}
              placeholder="e.g. 123456789012345"
            />
          </Field>
          <Field label="Meta Access Token">
            <Input
              type="password"
              value={form.meta_access_token ?? ""}
              onChange={(e) => set("meta_access_token", e.target.value)}
              placeholder="EAAG..."
            />
          </Field>
          <Field label="Meta Verify Token (you choose this)">
            <Input
              value={form.meta_verify_token ?? ""}
              onChange={(e) => set("meta_verify_token", e.target.value)}
              placeholder="paste the same value into Meta's webhook config"
            />
          </Field>
          <Field label="WhatsApp Report Number (receives 8 pm daily report)">
            <Input
              value={form.whatsapp_report_number ?? ""}
              onChange={(e) => set("whatsapp_report_number", e.target.value)}
              placeholder="+923001234567"
            />
          </Field>
          <div className="md:col-span-2">
            <Label>Webhook URL for Meta (read-only)</Label>
            <div className="mt-1 flex gap-2">
              <Input
                readOnly
                value={META_WEBHOOK_URL || "Configure VITE_SUPABASE_URL to show the webhook URL"}
                className="font-mono text-xs"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                disabled={!META_WEBHOOK_URL}
                onClick={() => {
                  if (!META_WEBHOOK_URL) return;
                  navigator.clipboard.writeText(META_WEBHOOK_URL);
                  toast.success("Webhook URL copied");
                }}
              >
                Copy
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Paste this into Meta WhatsApp Configuration Webhooks as the Callback URL. Use the
              Verify Token above.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Email (Resend)</CardTitle>
        </CardHeader>
        <CardContent>
          <Field label="Resend API Key">
            <Input
              type="password"
              value={form.resend_api_key ?? ""}
              onChange={(e) => set("resend_api_key", e.target.value)}
            />
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sales Rep & Bank Details</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Sales Rep Name">
            <Input
              value={form.sales_rep_name ?? ""}
              onChange={(e) => set("sales_rep_name", e.target.value)}
            />
          </Field>
          <Field label="Sales Rep Phone">
            <Input
              value={form.sales_rep_phone ?? ""}
              onChange={(e) => set("sales_rep_phone", e.target.value)}
            />
          </Field>
          <div className="md:col-span-2">
            <Label>Bank details (printed on invoices)</Label>
            <Textarea
              rows={3}
              value={form.bank_details ?? ""}
              onChange={(e) => set("bank_details", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Reorder Alerts & Delivery Defaults</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="Reorder Alert Threshold (days)">
            <Input
              type="number"
              value={form.reorder_threshold_days ?? 14}
              onChange={(e) => set("reorder_threshold_days", Number(e.target.value))}
            />
          </Field>
          <Field label="Default Petrol Rate (Rs./litre)">
            <Input
              type="number"
              step="0.01"
              value={form.petrol_rate_per_litre ?? 297.53}
              onChange={(e) => set("petrol_rate_per_litre", Number(e.target.value))}
            />
          </Field>
          <Field label="Default Vehicle">
            <select
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={form.default_vehicle_type ?? "bike125"}
              onChange={(e) => set("default_vehicle_type", e.target.value)}
            >
              <option value="bike70">Bike / 70cc</option>
              <option value="bike125">Bike / 125cc</option>
              <option value="car">Car</option>
              <option value="suzuki">Suzuki Loader</option>
              <option value="pickup">Pickup Truck</option>
            </select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Autonomous Agents</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Toggle
            label="Daily payment reminder agent (9:00 AM PKT)"
            desc="Auto WhatsApp + Email on day 15, then weekly."
            checked={!!form.auto_reminders_enabled}
            onChange={(v) => set("auto_reminders_enabled", v)}
          />
          <Toggle
            label="Daily group expense + delivery report (8:00 PM PKT)"
            desc="Compiles today's spend, deliveries and outstanding totals."
            checked={!!form.daily_report_enabled}
            onChange={(v) => set("daily_report_enabled", v)}
          />
          <Toggle
            label="Day End Notification (WhatsApp group)"
            desc="Full day-end summary: production, deliveries, payments, expenses, stock & P&L."
            checked={!!form.day_end_notification_enabled}
            onChange={(v) => set("day_end_notification_enabled", v)}
          />
          <div className="rounded-lg border border-border p-4">
            <Label>Day End Report Time (PKT)</Label>
            <Input
              type="time"
              value={(form.day_end_report_time ?? "20:00").slice(0, 5)}
              onChange={(e) => set("day_end_report_time", e.target.value)}
              className="mt-1 w-40"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Default 20:00 (8:00 PM PKT). Scheduled job currently runs at 15:00 UTC; changing the
              time here updates the saved preference shown on the dashboard.
            </p>
          </div>
        </CardContent>
      </Card>

      <Button onClick={save} size="lg">
        Save settings
      </Button>

      {isAdmin && <OpeningBalanceSettings />}
      {isAdmin && <WhatsAppRoutingSettings />}
      {isAdmin && <UsersManagement />}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-4">
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{desc}</div>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}
