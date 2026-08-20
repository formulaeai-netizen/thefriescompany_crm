import { createFileRoute } from "@tanstack/react-router";
import type { FormEvent } from "react";
import { useState } from "react";
import { supabase } from "@/lib/supabase";

export const Route = createFileRoute("/invest")({ component: InvestPage });

function InvestPage() {
  const [form, setForm] = useState({
    name: "",
    contact: "",
    city: "",
    interest_amount: "",
    message: "",
  });
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">("idle");
  const update = (key: keyof typeof form, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState("saving");
    const { error } = await (supabase as any).from("investor_leads").insert({
      name: form.name.trim(),
      contact: form.contact.trim(),
      city: form.city.trim(),
      interest_amount: Number(form.interest_amount),
      message: form.message.trim() || null,
    });
    if (error) {
      setState("error");
      return;
    }
    setState("done");
    setForm({ name: "", contact: "", city: "", interest_amount: "", message: "" });
  };

  return (
    <main className="min-h-screen bg-background">
      <section className="border-b">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-10 md:grid-cols-[1.3fr_0.7fr] md:py-14">
          <div>
            <p className="text-sm font-medium text-primary">The Fries Company</p>
            <h1 className="mt-2 max-w-3xl text-4xl font-semibold tracking-normal md:text-5xl">
              Investment interest for a growing frozen-food operation.
            </h1>
            <p className="mt-4 max-w-2xl text-muted-foreground">
              This page shares intentionally approved, high-level company information only. Internal
              CRM financials, payroll, supplier data and owner dashboards stay private.
            </p>
          </div>
          <div className="border p-5">
            <p className="text-sm font-medium">Public summary</p>
            <dl className="mt-4 space-y-3 text-sm">
              <div>
                <dt className="text-muted-foreground">Category</dt>
                <dd>Frozen food production and B2B supply</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Operating model</dt>
                <dd>Demand-led orders, production planning and delivery accountability</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Next step</dt>
                <dd>Submit interest for Admin review</dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-5 px-5 py-8 md:grid-cols-3">
        <article className="border p-5">
          <h2 className="font-semibold">Product Range</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Frozen potato and food-service products for commercial customers.
          </p>
        </article>
        <article className="border p-5">
          <h2 className="font-semibold">Operating Foundation</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Order intake, production planning, delivery proof and customer follow-up workflows.
          </p>
        </article>
        <article className="border p-5">
          <h2 className="font-semibold">Investor Review</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Submissions enter a private Admin pipeline for follow-up and due diligence.
          </p>
        </article>
      </section>
      <section className="mx-auto max-w-6xl px-5 pb-12">
        <div className="max-w-xl border p-5">
          <h2 className="text-xl font-semibold">Register Investment Interest</h2>
          <form className="mt-4 grid gap-3" onSubmit={submit}>
            <input
              required
              className="rounded border bg-background p-2"
              placeholder="Name"
              value={form.name}
              onChange={(event) => update("name", event.target.value)}
            />
            <input
              required
              className="rounded border bg-background p-2"
              placeholder="Contact"
              value={form.contact}
              onChange={(event) => update("contact", event.target.value)}
            />
            <input
              required
              className="rounded border bg-background p-2"
              placeholder="City"
              value={form.city}
              onChange={(event) => update("city", event.target.value)}
            />
            <input
              required
              type="number"
              min="1"
              className="rounded border bg-background p-2"
              placeholder="Investment interest amount (Rs.)"
              value={form.interest_amount}
              onChange={(event) => update("interest_amount", event.target.value)}
            />
            <textarea
              className="min-h-24 rounded border bg-background p-2"
              placeholder="Message (optional)"
              value={form.message}
              onChange={(event) => update("message", event.target.value)}
            />
            <button
              className="rounded bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50"
              disabled={state === "saving"}
            >
              {state === "saving" ? "Submitting..." : "Submit Interest"}
            </button>
          </form>
          {state === "done" ? (
            <p className="mt-3 text-sm text-emerald-600">
              Thank you. Our team will review your interest.
            </p>
          ) : null}
          {state === "error" ? (
            <p className="mt-3 text-sm text-destructive">
              Unable to submit right now. Please try again later.
            </p>
          ) : null}
        </div>
      </section>
    </main>
  );
}
