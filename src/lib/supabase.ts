import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Tafadhali weka VITE_PUBLIC_SUPABASE_URL na VITE_PUBLIC_SUPABASE_ANON_KEY kwenye faili lako la .env");
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);