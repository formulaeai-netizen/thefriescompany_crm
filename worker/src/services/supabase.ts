import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { WorkerConfig } from "../config.js";

export function createWorkerSupabaseClient(config: WorkerConfig): SupabaseClient {
  return createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
