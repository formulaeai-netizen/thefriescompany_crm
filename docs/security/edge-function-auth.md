# Gate `payment-reminder-agent` and `daily-group-report`

Once login is enabled, the browser automatically attaches the signed-in
user's JWT when calling `supabase.functions.invoke(...)`. Add this guard
at the top of each edge function so they reject anonymous callers:

```ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const authHeader = req.headers.get("Authorization");
if (!authHeader?.startsWith("Bearer ")) {
  return new Response("Unauthorized", { status: 401 });
}

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_ANON_KEY")!,
  { global: { headers: { Authorization: authHeader } } },
);

const { data: { user }, error } = await supabase.auth.getUser();
if (error || !user) {
  return new Response("Unauthorized", { status: 401 });
}
```

Also make sure each function is deployed WITHOUT `--no-verify-jwt` so
Supabase enforces JWT presence at the gateway as well.