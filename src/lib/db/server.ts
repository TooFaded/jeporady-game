import "server-only";
import { createClient } from "@supabase/supabase-js";
export function database() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (
    !url ||
    !key ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    (process.env.SUPABASE_JWT_SECRET?.length ?? 0) < 32 ||
    (process.env.RATE_LIMIT_SALT?.length ?? 0) < 32
  )
    throw new Error("NOT_CONFIGURED");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
