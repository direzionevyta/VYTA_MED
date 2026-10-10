import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { useActiveOrganizationId, useCached } from '../lib/data'
import { supabase } from '../lib/supabase'

type Row = Record<string, unknown>
type PageResult<T> = { data: T[] | null; error: { message: string } | null }

async function collectPages<T>(load: (from: number, to: number) => PromiseLike<PageResult<T>>) {
  const result: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await load(from, from + 999)
    if (error) throw error
    result.push(...(data ?? []))
    if (!data || data.length < 1000) return result
  }
}

function downloadJson(name: string, content: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(content, null, 2)], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

function fromBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

async function deriveExportKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: 600_000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function encryptExport(bundle: unknown, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveExportKey(password, salt)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(bundle)),
  )
  return {
    format: 'vyta-med-encrypted-export-v1',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600_000, salt: toBase64(salt) },
    cipher: { name: 'AES-GCM', iv: toBase64(iv) },
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  }
}

async function decryptExport(envelope: Record<string, unknown>, password: string) {
  if (envelope.format !== 'vyta-med-encrypted-export-v1') throw new Error('Formato file non riconosciuto.')
  const kdf = envelope.kdf as { salt?: string; iterations?: number } | undefined
  const cipher = envelope.cipher as { iv?: string } | undefined
  if (!kdf?.salt || !kdf.iterations || !cipher?.iv || typeof envelope.ciphertext !== 'string') {
    throw new Error('File incompleto o danneggiato.')
  }
  if (kdf.iterations !== 600_000 || fromBase64(kdf.salt).length !== 16 || fromBase64(cipher.iv).length !== 12) {
    throw new Error('Parametri di cifratura non validi.')
  }
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(fromBase64(kdf.salt)), iterations: kdf.iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(cipher.iv) }, key, fromBase64(envelope.ciphertext),
  )
  return JSON.parse(new TextDecoder().decode(plaintext)) as unknown
}

export default function PrivacyDati() {
  const { profile } = useAuth()
  const organization = useActiveOrganizationId()
  const queryClient = useQueryClient()
  const [months, setMonths] = useState('')
  const [exportPassword, setExportPassword] = useState('')
  const [exportPasswordAgain, setExportPasswordAgain] = useState('')
  const [importPassword, setImportPassword] = useState('')
  const [importFile, setImportFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const setting = useCached<{ value: unknown } | null>(['retention-policy', organization.data ?? 'none'], async () => {
    if (!organization.data) return null
    const { data, error } = await supabase.from('settings').select('value')
      .eq('organization_id', organization.data).eq('key', 'retention_period_months').maybeSingle()
    if (error) throw error
    return data
  }, !!organization.data)
  const policyMonths = typeof setting.data?.value === 'number' ? setting.data.value : null

  useEffect(() => {
    setMonths(policyMonths ? String(policyMonths) : '')
  }, [policyMonths])

  const cutoff = useMemo(() => {
    if (!policyMonths) return null
    const date = new Date()
    date.setMonth(date.getMonth() - policyMonths)
    return date.toISOString()
  }, [policyMonths])
  const eligible = useCached<{ id: string; name: string; ends_at: string | null }[]>(
    ['retention-review', organization.data ?? 'none', cutoff ?? 'unset'],
    async () => {
      if (!organization.data || !cutoff) return []
      const { data: structures, error: structureError } = await supabase.from('structures').select('id')
        .eq('organization_id', organization.data)
      if (structureError) throw structureError
      const structureIds = (structures ?? []).map(row => row.id)
      if (!structureIds.length) return []
      const { data, error } = await supabase.from('events').select('id,name,ends_at')
        .eq('status', 'concluso').lt('ends_at', cutoff).in('structure_id', structureIds)
        .order('ends_at', { ascending: true }).limit(500)
      if (error) throw error
      return data ?? []
    }, !!organization.data && !!cutoff,
  )

  const savePolicy = async () => {
    if (!organization.data) return setMessage('Non riesco a identificare l’organizzazione attiva.')
    const parsed = Number(months)
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 120) return setMessage('Inserisci una durata intera tra 1 e 120 mesi.')
    setBusy(true); setMessage('')
    const { error } = await supabase.from('settings').upsert({
      organization_id: organization.data,
      key: 'retention_period_months',
      value: parsed,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id,key' })
    setBusy(false)
    if (error) setMessage(`Regola non salvata: ${error.message}`)
    else {
      setMessage('Regola salvata. Gli eventi conclusi oltre questa durata appariranno per la revisione periodica.')
      await queryClient.invalidateQueries({ queryKey: ['retention-policy'] })
      await queryClient.invalidateQueries({ queryKey: ['retention-review'] })
    }
  }

  const exportOrganization = async () => {
    if (!organization.data || !profile) return
    if (exportPassword.length < 14) return setMessage('Per proteggere il file, usa una password di almeno 14 caratteri.')
    if (exportPassword !== exportPasswordAgain) return setMessage('Le due password non coincidono.')
    if (!window.confirm('Il file conterrà dati personali e sanitari cifrati con la password scelta. Conservala separatamente: senza di essa il file non potrà essere aperto. Procedi solo su un dispositivo autorizzato. Vuoi continuare?')) return
    setBusy(true); setMessage('Preparazione esportazione…')
    try {
      const organizationId = organization.data
      const { data: org, error: orgError } = await supabase.from('organizations').select('id,name,slug')
        .eq('id', organizationId).single()
      if (orgError) throw orgError

      const [profiles, structures, eventTypes, crewTypes, settings] = await Promise.all([
        collectPages<Row>((from, to) => supabase.from('profiles').select('*').eq('organization_id', organizationId).range(from, to)),
        collectPages<Row>((from, to) => supabase.from('structures').select('*').eq('organization_id', organizationId).range(from, to)),
        collectPages<Row>((from, to) => supabase.from('event_types').select('*').eq('organization_id', organizationId).range(from, to)),
        collectPages<Row>((from, to) => supabase.from('crew_types').select('*').eq('organization_id', organizationId).range(from, to)),
        collectPages<Row>((from, to) => supabase.from('settings').select('*').eq('organization_id', organizationId).range(from, to)),
      ])
      const structureIds = structures.map(row => String(row.id))
      const events = structureIds.length ? await collectPages<Row>((from, to) =>
        supabase.from('events').select('*').in('structure_id', structureIds).range(from, to)) : []
      const eventIds = events.map(row => String(row.id))
      const related = async (table: 'zones' | 'crews', ids: string[]) => ids.length
        ? collectPages<Row>((from, to) => supabase.from(table).select('*').in('structure_id', ids).range(from, to)) : []
      const [zones, crews, interventions, eventPosts, userEvents, eventActivity] = await Promise.all([
        related('zones', structureIds), related('crews', structureIds),
        eventIds.length ? collectPages<Row>((from, to) => supabase.from('interventions').select('*').in('event_id', eventIds).range(from, to)) : [],
        eventIds.length ? collectPages<Row>((from, to) => supabase.from('event_posts').select('*').in('event_id', eventIds).range(from, to)) : [],
        eventIds.length ? collectPages<Row>((from, to) => supabase.from('user_events').select('*').in('event_id', eventIds).range(from, to)) : [],
        eventIds.length ? collectPages<Row>((from, to) => supabase.from('event_activity').select('*').in('event_id', eventIds).range(from, to)) : [],
      ])
      const { error: auditError } = await supabase.rpc('record_organization_export', { target_organization_id: organizationId })
      if (auditError) throw auditError
      const bundle = {
        format: 'vyta-med-organization-export-v1',
        exported_at: new Date().toISOString(),
        exported_by: profile.id,
        organization: org,
        data: { profiles, structures, zones, crews, events, interventions, event_posts: eventPosts, user_events: userEvents,
          event_activity: eventActivity, event_types: eventTypes, crew_types: crewTypes, settings },
      }
      const safeName = String(org.slug).replace(/[^a-z0-9_-]/gi, '_')
      const encrypted = await encryptExport(bundle, exportPassword)
      downloadJson(`vyta-med-${safeName}-${new Date().toISOString().slice(0, 10)}.vyta`, encrypted)
      setExportPassword(''); setExportPasswordAgain('')
      setMessage('Esportazione completata e registrata nel registro amministrativo.')
    } catch (error) {
      setMessage(`Esportazione non completata: ${error instanceof Error ? error.message : 'errore imprevisto'}`)
    } finally { setBusy(false) }
  }

  const decryptDownloadedExport = async () => {
    if (!importFile || !importPassword) return setMessage('Scegli un file esportato e inserisci la sua password.')
    if (importFile.size > 100 * 1024 * 1024) return setMessage('Il file supera il limite di apertura locale di 100 MB.')
    setBusy(true); setMessage('Apertura locale del file…')
    try {
      const envelope = JSON.parse(await importFile.text()) as Record<string, unknown>
      const decoded = await decryptExport(envelope, importPassword)
      const safeName = importFile.name.replace(/\.vyta$/i, '')
      downloadJson(`${safeName}-decifrato.json`, decoded)
      setMessage('File decifrato localmente e scaricato. Elimina la copia aperta e proteggi il nuovo JSON.')
    } catch {
      setMessage('Impossibile aprire il file: controlla password e integrità del file.')
    } finally { setBusy(false); setImportPassword('') }
  }

  return <section>
    <h3>Esportazione e conservazione</h3>
    <div className="card">
      <strong>Esporta l’organizzazione attiva</strong>
      <p className="muted">Scarica un archivio JSON cifrato con password, con utenti, configurazione, eventi e interventi. L’operazione viene registrata nel registro amministrativo. La password non viene inviata al server: conservala separatamente.</p>
      <div className="grid2">
        <input type="password" autoComplete="new-password" placeholder="Password esportazione (min. 14 caratteri)" value={exportPassword} onChange={e => setExportPassword(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder="Ripeti password esportazione" value={exportPasswordAgain} onChange={e => setExportPasswordAgain(e.target.value)} />
      </div>
      <button disabled={busy || !organization.data || !exportPassword || !exportPasswordAgain} onClick={() => void exportOrganization()}>{busy ? 'Attendi…' : 'Esporta dati organizzazione'}</button>
      <hr />
      <strong>Apri un’esportazione cifrata</strong>
      <p className="muted">La decifratura avviene in questo browser; il JSON leggibile viene scaricato sul dispositivo.</p>
      <div className="toolbar">
        <input type="file" accept=".vyta,application/json" onChange={e => setImportFile(e.target.files?.[0] ?? null)} />
        <input type="password" autoComplete="current-password" placeholder="Password del file" value={importPassword} onChange={e => setImportPassword(e.target.value)} />
        <button className="ghost" disabled={busy || !importFile || !importPassword} onClick={() => void decryptDownloadedExport()}>Decifra e scarica JSON</button>
      </div>
    </div>
    <div className="card">
      <strong>Regola di conservazione</strong>
      <p className="muted">Indica il periodo approvato dal titolare del trattamento o dal referente privacy. Non viene preimpostata una durata legale e l’app non elimina dati automaticamente.</p>
      <div className="toolbar">
        <label>Durata dalla conclusione dell’evento (mesi)
          <input type="number" min="1" max="120" step="1" value={months} onChange={e => setMonths(e.target.value)} placeholder="Da definire" />
        </label>
        <button disabled={busy || !organization.data} onClick={() => void savePolicy()}>Salva regola</button>
      </div>
      {policyMonths && cutoff && <p className="muted">Eventi conclusi oltre la soglia da verificare: <strong>{eligible.data?.length ?? 0}</strong>{(eligible.data?.length ?? 0) >= 500 ? ' (elenco limitato ai primi 500)' : ''}. La lista non contiene dati dei pazienti; prima di cancellare o anonimizzare, esporta e verifica gli obblighi di conservazione applicabili.</p>}
      {eligible.error && <p className="err">Impossibile calcolare gli eventi da verificare: {eligible.error.message}</p>}
      {message && <p role="status" className="muted">{message}</p>}
    </div>
  </section>
}
