import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.REACT_APP_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  '';

const supabaseAnonKey =
  process.env.REACT_APP_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase configuration. Set REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY.');
}

// Debug logging (only in development)
if (process.env.NODE_ENV === 'development') {
  console.log('Supabase Configuration:');
  console.log('URL:', supabaseUrl);
  console.log('Key (first 20 chars):', supabaseAnonKey.substring(0, 20) + '...');
  console.log('Environment variables:');
  console.log('REACT_APP_SUPABASE_URL:', process.env.REACT_APP_SUPABASE_URL || 'Not set (using fallback)');
  console.log('REACT_APP_SUPABASE_ANON_KEY:', process.env.REACT_APP_SUPABASE_ANON_KEY ? 'Set' : 'Not set (using fallback)');
}

// Create Supabase client with explicit headers to ensure API key is sent
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: {
    headers: {
      apikey: supabaseAnonKey,
    },
  },
});

export default supabase;
