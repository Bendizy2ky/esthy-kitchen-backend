import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;

// STRICT CHECK: Force the app to look for the Service Key first.
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('🚨 CRITICAL ERROR: Supabase URL or Key is missing from environment variables!');
}

// Optional: Log a masked version of the key to prove which one it loaded on startup
const maskedKey = supabaseKey ? `${supabaseKey.substring(0, 10)}...` : 'undefined';
console.log(`🔌 Initializing Supabase with key starting with: ${maskedKey}`);

export const supabase = createClient(supabaseUrl, supabaseKey);