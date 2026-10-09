import { createClient } from 'npm:@supabase/supabase-js@2.117.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
})

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json(405, { error: 'Metodo non consentito.' })

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anonKey || !serviceKey) return json(500, { error: 'Configurazione server incompleta.' })

  const authorization = request.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'Accesso richiesto.' })

  const callerClient = createClient(url, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: authData, error: authError } = await callerClient.auth.getUser()
  if (authError || !authData.user) return json(401, { error: 'Sessione non valida.' })

  const adminClient = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: caller, error: callerError } = await adminClient.from('profiles')
    .select('id,role,active,organization_id,is_platform_admin')
    .eq('id', authData.user.id).maybeSingle()
  if (callerError) return json(500, { error: 'Impossibile verificare i permessi.' })
  if (!caller?.active || caller.role !== 'admin') return json(403, { error: 'È necessario un account amministratore attivo.' })

  const contentType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') return json(415, { error: 'Formato della richiesta non valido.' })
  const declaredLength = Number(request.headers.get('Content-Length') ?? 0)
  if (declaredLength > 16_384) return json(413, { error: 'Richiesta troppo grande.' })
  let body: Record<string, unknown>
  try {
    const rawBody = await request.text()
    if (new TextEncoder().encode(rawBody).byteLength > 16_384) return json(413, { error: 'Richiesta troppo grande.' })
    const parsed: unknown = JSON.parse(rawBody)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return json(400, { error: 'Richiesta non valida.' })
    body = parsed as Record<string, unknown>
  } catch { return json(400, { error: 'Richiesta non valida.' }) }
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : ''
  const role = body.role
  const organizationId = typeof body.organization_id === 'string' ? body.organization_id : ''
  const crewId = typeof body.crew_id === 'string' && body.crew_id ? body.crew_id : null
  const validEmail = email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  if (!validEmail || !fullName || fullName.length > 120 || password.length < 12 || password.length > 128 || !organizationId || !['admin', 'co', 'operatore', 'medico'].includes(String(role))) {
    return json(400, { error: 'Inserisci email, nome, password, organizzazione e ruolo validi.' })
  }

  const { data: organization, error: organizationError } = await adminClient.from('organizations')
    .select('id,active').eq('id', organizationId).maybeSingle()
  if (organizationError) return json(500, { error: 'Impossibile verificare l’organizzazione.' })
  if (!organization?.active) return json(400, { error: 'L’organizzazione selezionata non è attiva.' })
  if (!caller.is_platform_admin && caller.organization_id !== organizationId) {
    return json(403, { error: 'Puoi creare utenti solo nella tua organizzazione.' })
  }

  if (crewId) {
    const { data: crew, error: crewError } = await adminClient.from('crews').select('id,structure_id').eq('id', crewId).maybeSingle()
    if (crewError) return json(500, { error: 'Impossibile verificare l’equipaggio.' })
    if (!crew?.structure_id) return json(400, { error: 'L’equipaggio selezionato non è valido.' })
    const { data: structure, error: structureError } = await adminClient.from('structures').select('organization_id')
      .eq('id', crew.structure_id).maybeSingle()
    if (structureError) return json(500, { error: 'Impossibile verificare la struttura.' })
    if (structure?.organization_id !== organizationId) return json(400, { error: 'L’equipaggio appartiene a un’altra organizzazione.' })
  }

  const { data: created, error: createError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  })
  if (createError || !created.user) return json(400, { error: 'Creazione account non riuscita. Verifica i dati inseriti o contatta il supporto.' })

  const { error: profileError } = await adminClient.from('profiles').upsert({
    id: created.user.id,
    email,
    full_name: fullName,
    role,
    crew_id: crewId,
    active: true,
    organization_id: organizationId,
    is_platform_admin: false,
  }, { onConflict: 'id' })
  if (profileError) {
    await adminClient.auth.admin.deleteUser(created.user.id)
    return json(500, { error: 'Account creato, ma il profilo non è stato salvato. L’account temporaneo è stato rimosso.' })
  }

  return json(201, { user_id: created.user.id })
})
