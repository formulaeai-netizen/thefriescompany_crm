// Untyped re-export of the Supabase client.
//
// Lovable Cloud is enabled, so src/integrations/supabase/types.ts is managed
// by the migration system and reflects the (empty) Cloud schema. This app
// actually talks to an external Supabase project whose tables are not in
// those types. To keep the existing app code working without spreading
// `as any` everywhere, import the client from here.
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase as typedSupabase } from "@/integrations/supabase/client";

export const supabase = typedSupabase as unknown as SupabaseClient<any, "public", any>;
