import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://mpjxulzllmmoiqaqwart.supabase.co';
const supabaseAnonKey = 'sb_publishable_0Xkatb8dUNbdP44AWek6Hg_Br4SNyf2';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
