import { useActiveOrganizationId, useCached } from '../lib/data'
import { supabase } from '../lib/supabase'
import type { Organization, Profile } from '../lib/types'

interface AuditEntry {
  id: number
  organization_id: string | null
  actor_id: string | null
  table_name: string
  record_id: string | null
  operation: 'INSERT' | 'UPDATE' | 'DELETE' | 'EXPORT'
  changed_fields: string[]
  occurred_at: string
}

const TABLE_LABEL: Record<string, string> = {
  organizations: 'Organizzazione', profiles: 'Utenti', structures: 'Strutture', zones: 'Spazi',
  event_types: 'Tipi evento', crew_types: 'Tipi equipaggio', settings: 'Impostazioni',
  events: 'Eventi', crews: 'Equipaggi', event_posts: 'Postazioni', user_events: 'Accessi agli eventi',
  interventions: 'Interventi',
}
const OP_LABEL: Record<AuditEntry['operation'], string> = {
  INSERT: 'Creato', UPDATE: 'Modificato', DELETE: 'Eliminato', EXPORT: 'Esportazione dati',
}

export default function RegistroAttivita({ canManagePlatform }: { canManagePlatform: boolean }) {
  const organization = useActiveOrganizationId()
  const entries = useCached<AuditEntry[]>(['admin-audit', canManagePlatform ? 'all' : organization.data ?? 'none'], async () => {
    let query = supabase.from('admin_audit_log').select('*').order('occurred_at', { ascending: false }).limit(100)
    if (!canManagePlatform) {
      if (!organization.data) return []
      query = query.eq('organization_id', organization.data)
    }
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as AuditEntry[]
  }, canManagePlatform || !!organization.data)
  const profiles = useCached<Profile[]>(['audit-actors', canManagePlatform ? 'all' : organization.data ?? 'none'], async () => {
    let query = supabase.from('profiles').select('id,full_name,organization_id').order('full_name')
    if (!canManagePlatform) {
      if (!organization.data) return []
      query = query.eq('organization_id', organization.data)
    }
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as Profile[]
  }, canManagePlatform || !!organization.data)
  const organizations = useCached<Organization[]>(['audit-organizations', canManagePlatform ? 'all' : organization.data ?? 'none'], async () => {
    let query = supabase.from('organizations').select('id,name').order('name')
    if (!canManagePlatform) {
      if (!organization.data) return []
      query = query.eq('id', organization.data)
    }
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as Organization[]
  }, canManagePlatform || !!organization.data)

  return <section>
    <h3>Registro amministrativo</h3>
    <p className="muted">Ultime 100 operazioni. Il registro conserva autore, data e campi modificati, senza copiare valori clinici o note degli interventi.</p>
    {entries.isLoading && <p>Caricamento…</p>}
    {entries.error && <p className="err">Registro non disponibile: {entries.error.message}</p>}
    {!entries.isLoading && !(entries.data?.length) && <p className="muted">Nessuna operazione registrata da questa migrazione.</p>}
    {!!entries.data?.length && <div className="tablewrap"><table>
      <thead><tr><th>Data e ora</th>{canManagePlatform && <th>Organizzazione</th>}<th>Utente</th><th>Operazione</th><th>Area</th><th>Campi</th></tr></thead>
      <tbody>{entries.data.map(entry => <tr key={entry.id}>
        <td>{new Date(entry.occurred_at).toLocaleString('it-IT')}</td>
        {canManagePlatform && <td>{organizations.data?.find(item => item.id === entry.organization_id)?.name ?? '—'}</td>}
        <td>{profiles.data?.find(item => item.id === entry.actor_id)?.full_name ?? (entry.actor_id ? `Account ${entry.actor_id.slice(0, 8)}` : 'Sistema')}</td>
        <td>{OP_LABEL[entry.operation]}</td>
        <td>{entry.operation === 'EXPORT' ? 'Dati organizzazione' : TABLE_LABEL[entry.table_name] ?? entry.table_name}</td>
        <td>{entry.changed_fields?.join(', ') || '—'}</td>
      </tr>)}</tbody>
    </table></div>}
  </section>
}
