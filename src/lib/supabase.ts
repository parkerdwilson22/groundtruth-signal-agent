import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env.local and fill them in.',
  );
}

/**
 * Shared Supabase client. The publishable/anon key is safe on the client —
 * access is gated by RLS policies in supabase/schema.sql.
 */
export const supabase = createClient(url, anonKey);
