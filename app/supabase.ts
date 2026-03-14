import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://glhctigcfphwalgfdmsy.supabase.co';
const supabaseKey = 'sb_publishable_1gugEQpgorS4Oax7Q2zJ7g_XDMx1GiV';

export const supabase = createClient(supabaseUrl, supabaseKey);