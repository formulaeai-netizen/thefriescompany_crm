import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/trust")({
  head: () => ({
    meta: [
      { title: "Trust & Security — Fry Guys CRM" },
      { name: "description", content: "How Fry Guys CRM handles security, privacy, and data." },
    ],
  }),
  component: TrustPage,
});

function TrustPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Trust & Security</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          This page is maintained by Fry Guys to answer common security and privacy
          questions about this internal CRM. It is editable project content and is not an
          independent certification.
        </p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Access</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>The CRM is an internal tool used by Fry Guys staff. Access is shared via the
          application URL. Customers do not have logins to this system.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Hosting & platform</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Hosted on the Lovable platform with a managed Postgres database and serverless
          functions. Data in transit uses HTTPS. Backend secrets (Twilio, Resend) are stored as
          environment variables and accessed only by server-side code.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Data we store</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Client contact details, invoices, expenses, and message-delivery logs. We do not store
          payment card data.</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Subprocessors</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>Twilio (WhatsApp delivery), Resend (email delivery), Supabase (database & functions).</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Contact</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>For security questions or data requests, contact Fry Guys directly.</p>
        </CardContent>
      </Card>
    </div>
  );
}