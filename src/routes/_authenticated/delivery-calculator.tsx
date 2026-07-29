import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Truck, Fuel, MapPin, Save } from "lucide-react";

export const Route = createFileRoute("/_authenticated/delivery-calculator")({
  component: DeliveryCalculatorPage,
});

type Vehicle = { key: string; label: string; efficiency: number };
const VEHICLES: Vehicle[] = [
  { key: "bike70", label: "🏍️ Bike / 70cc", efficiency: 35 },
  { key: "bike125", label: "🏍️ Bike / 125cc", efficiency: 45 },
  { key: "car", label: "🚗 Car", efficiency: 12 },
  { key: "suzuki", label: "🚛 Suzuki Loader", efficiency: 8 },
  { key: "pickup", label: "🚌 Pickup Truck", efficiency: 7 },
];

const pkr = (n: number) => `Rs. ${Math.round(n).toLocaleString("en-PK")}`;

function DeliveryCalculatorPage() {
  const qc = useQueryClient();

  const settingsQ = useQuery({
    queryKey: ["settings-row"],
    queryFn: async () => {
      const { data, error } = await supabase.from("settings").select("*").limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const areasQ = useQuery({
    queryKey: ["delivery-areas"],
    queryFn: async () => {
      const { data, error } = await supabase.from("delivery_areas").select("*").order("area_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const invoicesQ = useQuery({
    queryKey: ["invoices-min"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, invoice_no, clients(legal_name)")
        .order("date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const historyQ = useQuery({
    queryKey: ["delivery-calcs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("delivery_calculations")
        .select("*, invoices(invoice_no)")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

  const [petrolRate, setPetrolRate] = useState<number>(297.53);
  useEffect(() => {
    const s: any = settingsQ.data;
    if (s?.petrol_rate_per_litre) setPetrolRate(Number(s.petrol_rate_per_litre));
    if (s?.default_vehicle_type) setVehicleKey(s.default_vehicle_type);
  }, [settingsQ.data]);

  const [areaId, setAreaId] = useState<string>("");
  const [customDistance, setCustomDistance] = useState(false);
  const [distanceKm, setDistanceKm] = useState<number>(10);
  const [vehicleKey, setVehicleKey] = useState<string>("bike125");
  const [returnTrip, setReturnTrip] = useState(true);
  const [linkedInvoice, setLinkedInvoice] = useState<string>("");
  const [notes, setNotes] = useState("");

  const selectedArea = (areasQ.data ?? []).find((a: any) => a.id === areaId);
  const oneWay = customDistance ? distanceKm : Number(selectedArea?.distance_km ?? 0);
  const totalDist = returnTrip ? oneWay * 2 : oneWay;
  const vehicle = VEHICLES.find((v) => v.key === vehicleKey)!;
  const litres = vehicle.efficiency > 0 ? totalDist / vehicle.efficiency : 0;
  const fuelCost = litres * petrolRate;

  // Third party estimates
  const [bykeaWeight, setBykeaWeight] = useState("light");
  const bykeaFare = 80 + 25 * totalDist + (bykeaWeight === "medium" || bykeaWeight === "heavy" ? 50 : 0);

  const [yangoType, setYangoType] = useState<"moto" | "car">("moto");
  const yangoFare = yangoType === "moto" ? 60 + 20 * totalDist : 150 + 35 * totalDist;

  const [tcsWeight, setTcsWeight] = useState<number>(5);
  const [tcsCity, setTcsCity] = useState<"same" | "inter">("same");
  const tcsFare = tcsCity === "same"
    ? (tcsWeight <= 5 ? 250 : tcsWeight <= 15 ? 400 : 600)
    : 500 + Math.max(0, tcsWeight - 5) * 50;

  const [customName, setCustomName] = useState("");
  const [customCost, setCustomCost] = useState<number>(0);

  // Comparison
  const comparison = useMemo(() => {
    const selfRows = VEHICLES.map((v) => {
      const l = v.efficiency > 0 ? totalDist / v.efficiency : 0;
      return { method: v.label, cost: l * petrolRate, notes: "Self delivery" };
    });
    return [
      ...selfRows,
      { method: "Bykea", cost: bykeaFare, notes: "Estimated" },
      { method: "Yango Moto", cost: 60 + 20 * totalDist, notes: "Estimated" },
      { method: "Yango Car", cost: 150 + 35 * totalDist, notes: "Estimated" },
      { method: "TCS/Leopards", cost: tcsFare, notes: "Fixed rate" },
    ].sort((a, b) => a.cost - b.cost);
  }, [totalDist, petrolRate, bykeaFare, tcsFare]);
  const cheapest = comparison[0]?.method;

  const savePetrolRate = useMutation({
    mutationFn: async () => {
      const s: any = settingsQ.data;
      if (!s) return;
      const { error } = await supabase.from("settings").update({
        petrol_rate_per_litre: petrolRate,
        default_vehicle_type: vehicleKey,
      }).eq("id", s.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Default petrol rate & vehicle saved");
      qc.invalidateQueries({ queryKey: ["settings-row"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const saveCalc = useMutation({
    mutationFn: async () => {
      const inv = (invoicesQ.data ?? []).find((i: any) => i.id === linkedInvoice);
      const { error } = await supabase.from("delivery_calculations").insert({
        invoice_id: linkedInvoice || null,
        client_id: null,
        delivery_area: selectedArea?.area_name ?? (customDistance ? `Custom ${oneWay}km` : null),
        distance_km: totalDist,
        vehicle_type: vehicle.label,
        petrol_rate: petrolRate,
        fuel_efficiency: vehicle.efficiency,
        calculated_fuel_cost: fuelCost,
        service_fee: 0,
        total_delivery_cost: fuelCost,
        notes: notes || (inv ? `Linked to ${inv.invoice_no}` : null),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Delivery cost saved to history");
      qc.invalidateQueries({ queryKey: ["delivery-calcs"] });
      setNotes("");
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight flex items-center gap-2">
          <Truck className="h-7 w-7 text-primary" /> Delivery Cost Calculator
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Compare self-delivery fuel costs against third-party services.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Fuel className="h-4 w-4 text-primary" /> Petrol Rate</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-4">
          <div>
            <Label>Current Petrol Rate (Rs./litre)</Label>
            <Input
              type="number"
              step="0.01"
              value={petrolRate}
              onChange={(e) => setPetrolRate(Number(e.target.value))}
              className="mt-1 w-48"
            />
            <p className="mt-1 text-xs text-muted-foreground">Update this daily as petrol prices change.</p>
          </div>
          <Button variant="outline" onClick={() => savePetrolRate.mutate()} disabled={savePetrolRate.isPending}>
            <Save className="mr-2 h-4 w-4" /> Save as default
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Self Delivery Calculator</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <Label>Delivery Area</Label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Custom distance <Switch checked={customDistance} onCheckedChange={setCustomDistance} />
                </label>
              </div>
              {customDistance ? (
                <Input
                  type="number"
                  step="0.1"
                  value={distanceKm}
                  onChange={(e) => setDistanceKm(Number(e.target.value))}
                  placeholder="Distance in km"
                  className="mt-1"
                />
              ) : (
                <Select value={areaId} onValueChange={setAreaId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select area" /></SelectTrigger>
                  <SelectContent>
                    {(areasQ.data ?? []).map((a: any) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.area_name} — {a.distance_km} km
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div>
              <Label>Vehicle Type</Label>
              <Select value={vehicleKey} onValueChange={setVehicleKey}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {VEHICLES.map((v) => (
                    <SelectItem key={v.key} value={v.key}>
                      {v.label} — {v.efficiency} km/L
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <div className="text-sm font-medium">Round trip</div>
                <div className="text-xs text-muted-foreground">Doubles distance for return</div>
              </div>
              <Switch checked={returnTrip} onCheckedChange={setReturnTrip} />
            </div>

            <div className="rounded-lg border border-primary/40 bg-primary/5 p-4 space-y-1 text-sm">
              <div>📍 Area: <span className="font-medium">{selectedArea?.area_name ?? (customDistance ? "Custom" : "—")}</span></div>
              <div>📏 Distance: {oneWay} km one way / {oneWay * 2} km round trip</div>
              <div>⛽ Vehicle: {vehicle.label}</div>
              <div>🔢 Fuel needed: {litres.toFixed(2)} litres</div>
              <div>💰 Petrol cost: {pkr(fuelCost)}</div>
              <div className="mt-2 border-t border-border pt-2 text-lg font-semibold text-primary">
                Total Delivery Cost: {pkr(fuelCost)}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Third Party Service</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="bykea">
              <TabsList className="grid grid-cols-4">
                <TabsTrigger value="bykea">Bykea</TabsTrigger>
                <TabsTrigger value="yango">Yango</TabsTrigger>
                <TabsTrigger value="tcs">TCS/Leopards</TabsTrigger>
                <TabsTrigger value="custom">Custom</TabsTrigger>
              </TabsList>
              <TabsContent value="bykea" className="space-y-3 pt-4">
                <div>
                  <Label>Package weight</Label>
                  <Select value={bykeaWeight} onValueChange={setBykeaWeight}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Up to 5 kg</SelectItem>
                      <SelectItem value="medium">5 – 15 kg</SelectItem>
                      <SelectItem value="heavy">15 – 30 kg</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-lg border border-border p-3 text-sm">
                  Estimated Bykea fare: <span className="font-semibold text-primary">{pkr(bykeaFare)}</span>
                  <div className="text-xs text-muted-foreground mt-1">Actual fare may vary. Open Bykea to confirm.</div>
                </div>
              </TabsContent>
              <TabsContent value="yango" className="space-y-3 pt-4">
                <div>
                  <Label>Vehicle</Label>
                  <Select value={yangoType} onValueChange={(v) => setYangoType(v as any)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="moto">Yango Moto</SelectItem>
                      <SelectItem value="car">Yango Car</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="rounded-lg border border-border p-3 text-sm">
                  Estimated Yango fare: <span className="font-semibold text-primary">{pkr(yangoFare)}</span>
                </div>
              </TabsContent>
              <TabsContent value="tcs" className="space-y-3 pt-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Weight (kg)</Label>
                    <Input type="number" value={tcsWeight} onChange={(e) => setTcsWeight(Number(e.target.value))} className="mt-1" />
                  </div>
                  <div>
                    <Label>City</Label>
                    <Select value={tcsCity} onValueChange={(v) => setTcsCity(v as any)}>
                      <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="same">Same city (Karachi)</SelectItem>
                        <SelectItem value="inter">Intercity</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="rounded-lg border border-border p-3 text-sm">
                  Estimated TCS/Leopards fare: <span className="font-semibold text-primary">{pkr(tcsFare)}</span>
                </div>
              </TabsContent>
              <TabsContent value="custom" className="space-y-3 pt-4">
                <div>
                  <Label>Service name</Label>
                  <Input value={customName} onChange={(e) => setCustomName(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label>Fixed cost (Rs.)</Label>
                  <Input type="number" value={customCost} onChange={(e) => setCustomCost(Number(e.target.value))} className="mt-1" />
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Method</th>
                  <th className="py-2 text-right">Cost</th>
                  <th className="py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {comparison.map((row) => (
                  <tr key={row.method} className={`border-b border-border/50 ${row.method === cheapest ? "bg-success/10" : ""}`}>
                    <td className="py-2">
                      {row.method}
                      {row.method === cheapest && <Badge className="ml-2 bg-success/20 text-success border-success/40" variant="outline">Cheapest</Badge>}
                    </td>
                    <td className="py-2 text-right tabular font-medium">{pkr(row.cost)}</td>
                    <td className="py-2 text-muted-foreground text-xs">{row.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Save to History / Link to Invoice</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Link to Invoice (optional)</Label>
            <Select value={linkedInvoice} onValueChange={setLinkedInvoice}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Select invoice" /></SelectTrigger>
              <SelectContent>
                {(invoicesQ.data ?? []).map((i: any) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.invoice_no} — {i.clients?.legal_name ?? "—"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1" />
          </div>
          <div className="md:col-span-2">
            <Button onClick={() => saveCalc.mutate()} disabled={saveCalc.isPending}>
              <Save className="mr-2 h-4 w-4" /> Save calculation
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" /> Recent Calculations</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2">Date</th>
                  <th className="py-2">Area</th>
                  <th className="py-2">Vehicle</th>
                  <th className="py-2 text-right">Cost</th>
                  <th className="py-2">Invoice</th>
                  <th className="py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {(historyQ.data ?? []).map((r: any) => (
                  <tr key={r.id} className="border-b border-border/50">
                    <td className="py-2 text-xs">{new Date(r.created_at).toLocaleDateString("en-PK")}</td>
                    <td className="py-2">{r.delivery_area ?? "—"}</td>
                    <td className="py-2 text-xs">{r.vehicle_type ?? "—"}</td>
                    <td className="py-2 text-right tabular">{pkr(Number(r.total_delivery_cost ?? 0))}</td>
                    <td className="py-2 text-xs">{r.invoices?.invoice_no ?? "—"}</td>
                    <td className="py-2 text-xs text-muted-foreground">{r.notes ?? ""}</td>
                  </tr>
                ))}
                {(historyQ.data ?? []).length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No calculations saved yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}