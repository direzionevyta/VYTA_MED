import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const demoMode = import.meta.env.VITE_DEMO_MODE === 'true'

if (demoMode) {
  const demoRef = import.meta.env.VITE_DEMO_SUPABASE_REF as string | undefined
  const productionRef = import.meta.env.VITE_PRODUCTION_SUPABASE_REF as string | undefined
  const actualRef = new URL(supabaseUrl).hostname.split('.')[0]
  if (!demoRef || !productionRef || demoRef === productionRef || demoRef !== actualRef) {
    throw new Error('Ambiente demo bloccato: configura un progetto Supabase dedicato e distinto dalla produzione.')
  }
}

export const supabase = createClient(
  supabaseUrl,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
)
