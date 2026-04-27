"use client";
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}

// Convenience singleton for use in client components
let _client: ReturnType<typeof createBrowserClient> | null = null;
export function supabase() {
  if (!_client) _client = createClient();
  return _client;
}
