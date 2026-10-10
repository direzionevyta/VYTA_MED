import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { all, useActiveOrganizationId, useCached, useRefData } from '../lib/data'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL } from '../lib/types'
import type { Crew, Ev, Organization, Profile, Role, Structure } from '../lib/types'
import ZoneMap from '../components/ZoneMap'
import { useEventSelection } from '../lib/eventSelection'
import { organizationUrl, tenantBasePath } from '../lib/tenant'

type Tab = 'organizzazioni' | 'strutture' | 'spazi' | 'eventi' | 'tipi_eq' | 'equipaggi' | 'utenti' | 'generale'
type Res = PromiseLike<{ error: { message: string } | null; data?: unknown }> & {
  select?: (columns?: string) => PromiseLike<{ error: { message: string } | null; data?: unknown }>
}

function useRun() {
  const qc = useQueryClient()
  return async (p: Res, key: string) => {
    const result = await (p.select ? p.select('*') : p)
    if (result.error) { alert(result.error.message); return false }
    if (Array.isArray(result.data) && result.data.length === 0) {
      alert('Nessuna riga modificata. Verifica i permessi del tuo account e riprova.')
      return false
    }
    await qc.invalidateQueries({ queryKey: [key] })
    return true
  }
}

function Spazi() {
  const { selectedEvent } = useEventSelection()
  const structureId = selectedEvent?.structure_id ?? ''
  const rd = useRefData(structureId || null)
  const run = useRun()
  const structure = rd.structures.find(s => s.id === structureId)
  const [name, setName] = useState('')
  const [parent, setParent] = useState('')
  const [kind, setKind] = useState('settore')
  const [placing, setPlacing] = useState('')
  const sorted = rd.zones.map(z => ({ z, label: rd.zoneLabel(z.id) })).sort((a, b) => a.label.localeCompare(b.label))
  if (!selectedEvent?.structure_id) return <div>
    <h3>Anelli e spazi</h3>
    <div className="event-required"><strong>Nessun evento selezionato</strong><p>Scegli un evento attivo dal menu in alto: qui verranno mostrati gli spazi della sua struttura.</p></div>
  </div>
  return (
    <div>
      <h3>Anelli e spazi</h3>
      <p className="muted">Evento: <strong>{selectedEvent.name}</strong> · Struttura collegata: <strong>{structure?.name ?? 'non trovata'}</strong></p>
      <p className="muted">La planimetria si gestisce in Impostazioni → Strutture; qui puoi organizzare gli spazi e i relativi punti sulla mappa.</p>
      <div className="toolbar">
        <input placeholder="Nome (es. Settore A)" value={name} onChange={e => setName(e.target.value)} />
        <select value={parent} onChange={e => setParent(e.target.value)}>
          <option value="">Livello principale</option>
          {sorted.map(({ z, label }) => <option key={z.id} value={z.id}>dentro: {label}</option>)}
        </select>
        <select value={kind} onChange={e => setKind(e.target.value)}>
          {['anello', 'settore', 'spazio', 'ingresso', 'altro'].map(k => <option key={k} value={k}>{k}</option>)}
        </select>
        <button disabled={!structureId} onClick={async () => {
          if (!name.trim()) return
          if (!structureId) return alert('Seleziona prima una struttura.')
          if (await run(supabase.from('zones').insert({ name: name.trim(), structure_id: structureId, parent_id: parent || null, kind, sort: rd.zones.length + 1 }), 'zones')) setName('')
        }}>Aggiungi</button>
      </div>
      {rd.mapImage && (
        <>
          <p className="muted">Per posizionare uno spazio sulla planimetria: scegli lo spazio e clicca sulla mappa.</p>
          <select value={placing} onChange={e => setPlacing(e.target.value)}>
            <option value="">Spazio da posizionare…</option>
            {sorted.map(({ z, label }) => <option key={z.id} value={z.id}>{label}</option>)}
          </select>
          <ZoneMap image={rd.mapImage} zones={rd.zones} selected={placing}
            onPick={setPlacing}
            onPlace={(x, y) => { if (placing) void run(supabase.from('zones').update({ map_x: x, map_y: y }).eq('id', placing), 'zones') }} />
        </>
      )}
      <div className="list">
        {sorted.map(({ z, label }) => (
          <div key={z.id} className="rowline">
            <span style={{ opacity: z.active ? 1 : 0.4 }}>{label} <small className="muted">({z.kind}){z.map_x != null ? ' 📌' : ''}</small></span>
            <span className="actions">
              <button className="ghost" onClick={() => {
                const n = window.prompt('Nome dello spazio', z.name)
                if (!n?.trim()) return
                const k = window.prompt('Tipo (anello, settore, spazio, ingresso, altro)', z.kind ?? 'spazio')
                if (k) void run(supabase.from('zones').update({ name: n.trim(), kind: k }).eq('id', z.id), 'zones')
              }}>Modifica</button>
              {z.map_x != null && <button className="ghost" onClick={() => run(supabase.from('zones').update({ map_x: null, map_y: null }).eq('id', z.id), 'zones')}>Togli da mappa</button>}
              <button className="ghost" onClick={() => {
                if (!z.active) {
                  if (confirm(`Ripristinare lo spazio “${z.name}”?`)) void run(supabase.from('zones').update({ active: true }).eq('id', z.id), 'zones')
                  return
                }
                if (!confirm(`Eliminare lo spazio “${z.name}”? Se è già usato, verrà archiviato per conservare lo storico.`)) return
                void (async () => {
                  const refs = await Promise.all([
                    supabase.from('interventions').select('id', { count: 'exact', head: true }).eq('zone_id', z.id),
                    supabase.from('zones').select('id', { count: 'exact', head: true }).eq('parent_id', z.id),
                    supabase.from('crews').select('id', { count: 'exact', head: true }).eq('base_zone_id', z.id),
                  ])
                  const error = refs.find(r => r.error)?.error
                  if (error) { alert(error.message); return }
                  const referenced = refs.some(r => (r.count ?? 0) > 0)
                  const result = referenced
                    ? await supabase.from('zones').update({ active: false }).eq('id', z.id)
                    : await supabase.from('zones').delete().eq('id', z.id)
                  if (result.error) alert(result.error.message)
                  else if (referenced) alert('Spazio archiviato: è collegato a interventi, equipaggi o altri spazi e resta nello storico.')
                  await run(Promise.resolve({ error: result.error }), 'zones')
                })()
              }}>{z.active ? 'Elimina' : 'Ripristina'}</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Strutture() {
  const { profile } = useAuth()
  const organizationId = useActiveOrganizationId()
  const rd = useRefData()
  const run = useRun()
  const [name, setName] = useState('')
  const activeTenant = tenantBasePath().replace(/^\//, '') || profile?.organization_slug || 'organizzazione'
  return <div>
    <h3>Strutture e planimetrie</h3>
    <p className="muted">Cliente attivo: <strong>{activeTenant}</strong></p>
    <p className="muted">Ogni struttura ha una planimetria e i propri spazi. Gli eventi restano collegati alla struttura scelta alla creazione.</p>
    <div className="toolbar"><input placeholder="Nome struttura / stadio" value={name} onChange={e => setName(e.target.value)} />
      <button disabled={organizationId.isLoading || !name.trim()} onClick={async () => {
        if (!name.trim()) return
        if (organizationId.isLoading) return alert('Attendi la verifica del cliente attivo.')
        if (organizationId.error) return alert(`Non riesco a verificare il cliente: ${organizationId.error.message}`)
        if (!organizationId.data) return alert(`Non trovo un’organizzazione attiva per “${activeTenant}”. Apri il link del cliente dalla sezione Clienti e riprova.`)
        const { error } = await supabase.from('structures').insert({ name: name.trim(), map_image: '', active: true, organization_id: organizationId.data })
        if (error) return alert(`Struttura non creata per “${activeTenant}”: ${error.message}`)
        setName('')
        await run(Promise.resolve({ error: null }), 'structures')
      }}>{organizationId.isLoading ? 'Verifica cliente…' : 'Aggiungi struttura'}</button>
    </div>
    <div className="cards">{rd.structures.map(s => <div className="card" key={s.id}>
      <div className="row"><strong>{s.name}</strong><span className="muted">{s.active ? 'Attiva' : 'Archiviata'}</span></div>
      <div className="actions">
        <button className="ghost" onClick={() => { const n = prompt('Nome struttura', s.name); if (n?.trim()) void run(supabase.from('structures').update({ name: n.trim() }).eq('id', s.id), 'structures') }}>Rinomina</button>
        <label className="button-like">Carica planimetria<input type="file" accept="image/*" hidden onChange={async e => {
          const file = e.target.files?.[0]
          if (!file) return
          try { await run(supabase.from('structures').update({ map_image: await toDataUrl(file) }).eq('id', s.id), 'structures') }
          catch (err) { alert((err as Error).message) }
          e.target.value = ''
        }} /></label>
        <button className="ghost" onClick={() => {
          if (!s.active) {
            if (confirm(`Ripristinare ${s.name}?`)) void run(supabase.from('structures').update({ active: true }).eq('id', s.id), 'structures')
            return
          }
          if (!confirm(`Eliminare ${s.name}? Se è già collegata a eventi, spazi o equipaggi verrà archiviata per conservare lo storico.`)) return
          void (async () => {
            const refs = await Promise.all([
              supabase.from('events').select('id', { count: 'exact', head: true }).eq('structure_id', s.id),
              supabase.from('zones').select('id', { count: 'exact', head: true }).eq('structure_id', s.id),
              supabase.from('crews').select('id', { count: 'exact', head: true }).eq('structure_id', s.id),
            ])
            const error = refs.find(r => r.error)?.error
            if (error) { alert(error.message); return }
            const referenced = refs.some(r => (r.count ?? 0) > 0)
            const result = referenced
              ? await supabase.from('structures').update({ active: false }).eq('id', s.id)
              : await supabase.from('structures').delete().eq('id', s.id)
            if (result.error) alert(result.error.message)
            else if (referenced) alert('Struttura archiviata: è ancora usata da eventi, spazi o equipaggi e resta nello storico.')
            await run(Promise.resolve({ error: result.error }), 'structures')
          })()
        }}>{s.active ? 'Elimina' : 'Ripristina'}</button>
      </div>
      {s.map_image && <img src={s.map_image} alt={`Planimetria ${s.name}`} style={{ maxWidth: '100%', borderRadius: 8 }} />}
    </div>)}</div>
  </div>
}

function TipiEvento() {
  const organizationId = useActiveOrganizationId()
  const rd = useRefData()
  const run = useRun()
  const [name, setName] = useState('')
  const [color, setColor] = useState('#2563eb')
  return (
    <div>
      <h3>Tipi di evento</h3>
      <div className="toolbar">
        <input placeholder="Nome (es. Ustione)" value={name} onChange={e => setName(e.target.value)} />
        <input type="color" value={color} onChange={e => setColor(e.target.value)} />
        <button onClick={async () => { if (!name.trim() || !organizationId.data) return; if (await run(supabase.from('event_types').insert({ name: name.trim(), color, sort: rd.types.length + 1, organization_id: organizationId.data }), 'event_types')) setName('') }}>Aggiungi</button>
      </div>
      <div className="list">
        {rd.types.map(t => (
          <div key={t.id} className="rowline">
            <span style={{ opacity: t.active ? 1 : 0.4 }}><span className="dot" style={{ background: t.color }} />{t.name}</span>
            <span className="actions">
              <input type="color" value={t.color} onChange={e => run(supabase.from('event_types').update({ color: e.target.value }).eq('id', t.id), 'event_types')} />
              <button className="ghost" onClick={() => { const n = window.prompt('Nuovo nome', t.name); if (n) void run(supabase.from('event_types').update({ name: n }).eq('id', t.id), 'event_types') }}>Rinomina</button>
              <button className="ghost" onClick={() => run(supabase.from('event_types').update({ active: !t.active }).eq('id', t.id), 'event_types')}>{t.active ? 'Disattiva' : 'Attiva'}</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TipiEquipaggio() {
  const organizationId = useActiveOrganizationId()
  const rd = useRefData()
  const run = useRun()
  const [name, setName] = useState('')
  return (
    <div>
      <h3>Tipi di equipaggio</h3>
      <div className="toolbar">
        <input placeholder="Nome (es. Ambulanza, PMA)" value={name} onChange={e => setName(e.target.value)} />
        <button onClick={async () => { if (!name.trim() || !organizationId.data) return; if (await run(supabase.from('crew_types').insert({ name: name.trim(), organization_id: organizationId.data }), 'crew_types')) setName('') }}>Aggiungi</button>
      </div>
      <div className="list">
        {rd.crewTypes.map(t => (
          <div key={t.id} className="rowline">
            <span style={{ opacity: t.active ? 1 : 0.4 }}>{t.name}</span>
            <span className="actions">
              <button className="ghost" onClick={() => { const n = window.prompt('Nuovo nome', t.name); if (n) void run(supabase.from('crew_types').update({ name: n }).eq('id', t.id), 'crew_types') }}>Rinomina</button>
              <button className="ghost" onClick={() => run(supabase.from('crew_types').update({ active: !t.active }).eq('id', t.id), 'crew_types')}>{t.active ? 'Disattiva' : 'Attiva'}</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Equipaggi() {
  const { selectedEvent } = useEventSelection()
  const [structureId, setStructureId] = useState('')
  const rd = useRefData(structureId || null)
  const run = useRun()
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [members, setMembers] = useState('2')
  const lastEventId = useRef<string | null>(null)
  useEffect(() => {
    const eventId = selectedEvent?.id ?? null
    if (eventId !== lastEventId.current) {
      lastEventId.current = eventId
      if (selectedEvent?.structure_id) setStructureId(selectedEvent.structure_id)
    }
  }, [selectedEvent?.id, selectedEvent?.structure_id])
  useEffect(() => {
    if (!structureId && rd.structures.length) setStructureId(selectedEvent?.structure_id ?? rd.structures.find(s => s.active)?.id ?? rd.structures[0].id)
  }, [structureId, selectedEvent?.structure_id, rd.structures])
  const structureOptions = rd.structures.filter(s => s.active || s.id === selectedEvent?.structure_id)
  return (
    <div>
      <h3>Equipaggi</h3>
      {selectedEvent && <p className="muted">Evento selezionato: <strong>{selectedEvent.name}</strong>. Equipaggi caricati dalla sua struttura.</p>}
      <label>Struttura<select value={structureId} onChange={e => setStructureId(e.target.value)}>
        {!structureOptions.length && <option value="">Nessuna struttura disponibile</option>}
        {structureOptions.map(s => <option key={s.id} value={s.id}>{s.name}{!s.active ? ' · Archiviata (evento selezionato)' : ''}</option>)}
      </select></label>
      <div className="toolbar">
        <input placeholder="Nome (es. Ambulanza 1)" value={name} onChange={e => setName(e.target.value)} />
        <select value={type} onChange={e => setType(e.target.value)}>
          <option value="">Tipo…</option>
          {rd.crewTypes.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <input type="number" style={{ width: 80 }} value={members} onChange={e => setMembers(e.target.value)} />
        <button onClick={async () => { if (!name.trim() || !structureId) return; if (await run(supabase.from('crews').insert({ name: name.trim(), structure_id: structureId, crew_type_id: type || null, members: Number(members) || 1 }), 'crews')) setName('') }}>Aggiungi</button>
      </div>
      <div className="list">
        {rd.crews.map(c => (
          <div key={c.id} className="rowline">
            <span style={{ opacity: c.active ? 1 : 0.4 }}>{c.name} <small className="muted">{rd.crewTypes.find(t => t.id === c.crew_type_id)?.name} · {c.members} pers.</small></span>
            <span className="actions">
              <select value={c.crew_type_id ?? ''} onChange={e => run(supabase.from('crews').update({ crew_type_id: e.target.value || null }).eq('id', c.id), 'crews')}>
                <option value="">Tipo…</option>
                {rd.crewTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <select value={c.base_zone_id ?? ''} onChange={e => run(supabase.from('crews').update({ base_zone_id: e.target.value || null }).eq('id', c.id), 'crews')}>
                <option value="">Base…</option>
                {rd.zones.map(z => <option key={z.id} value={z.id}>{rd.zoneLabel(z.id)}</option>)}
              </select>
              <button className="ghost" onClick={() => { const n = window.prompt('Numero componenti', String(c.members)); if (n) void run(supabase.from('crews').update({ members: Number(n) || 1 }).eq('id', c.id), 'crews') }}>Componenti</button>
              <button className="ghost" onClick={() => { const n = window.prompt('Nuovo nome', c.name); if (n) void run(supabase.from('crews').update({ name: n }).eq('id', c.id), 'crews') }}>Rinomina</button>
              <button className="ghost" onClick={() => run(supabase.from('crews').update({ active: !c.active }).eq('id', c.id), 'crews')}>{c.active ? 'Disattiva' : 'Attiva'}</button>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Organizzazioni() {
  const run = useRun()
  const organizations = useCached<Organization[]>(['organizations'], () => all<Organization>('organizations', 'name'))
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [demo, setDemo] = useState(false)
  const reservedSlugs = ['co', 'operatore', 'nuovo', 'equipaggi', 'schieramento', 'infermeria', 'archivio', 'impostazioni', 'assets', 'api']
  const makeSlug = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const saveName = (value: string) => { setName(value); setSlug(makeSlug(value)) }
  return <div>
    <h3>Organizzazioni clienti</h3>
    <p className="muted">Ogni organizzazione ha utenti e dati separati. Gli indirizzi personalizzati si collegheranno quando sarà configurato un dominio di proprietà.</p>
    <div className="card">
      <strong>Nuova organizzazione</strong>
      <div className="toolbar">
        <input placeholder="Nome cliente / organizzazione" value={name} onChange={e => saveName(e.target.value)} />
        <input aria-label="Identificativo URL" placeholder="identificativo-url" value={slug} onChange={e => setSlug(makeSlug(e.target.value))} />
        <label><input type="checkbox" checked={demo} onChange={e => setDemo(e.target.checked)} /> Ambiente demo</label>
        <button onClick={async () => {
          if (!name.trim() || !slug) return alert('Inserisci nome e identificativo.')
          if (reservedSlugs.includes(slug)) return alert('Questo identificativo è riservato dall’app. Scegline un altro.')
          const { error } = await supabase.from('organizations').insert({ name: name.trim(), slug, is_demo: demo })
          if (error) return alert(error.message)
          setName(''); setSlug(''); setDemo(false)
          await run(Promise.resolve({ error: null }), 'organizations')
        }}>Crea organizzazione</button>
      </div>
    </div>
    <div className="list">{(organizations.data ?? []).map(org => <div className="rowline" key={org.id}>
      <span><strong>{org.name}</strong> <small className="muted">· {org.slug} · {org.is_demo ? 'Demo' : 'Cliente'}</small> · <a href={organizationUrl(org.slug)}>{org.active ? 'Apri link' : 'Disattivata'}</a></span>
      <button className="ghost" disabled={!org.active} onClick={() => { void navigator.clipboard.writeText(organizationUrl(org.slug)).then(() => alert('Link copiato.')) }}>{org.active ? 'Copia link' : 'Disattivata'}</button>
      <button className="ghost" onClick={() => run(supabase.from('organizations').update({ active: !org.active }).eq('id', org.id), 'organizations')}>{org.active ? 'Disattiva' : 'Riattiva'}</button>
      <button className="danger" disabled={org.slug === 'principale'} onClick={() => {
        if (!window.confirm(`Vuoi eliminare definitivamente “${org.name}”? L’operazione è consentita solo se non ci sono utenti o dati collegati.`)) return
        const confirmation = window.prompt(`Per confermare, scrivi l’identificativo: ${org.slug}`)
        if (confirmation !== org.slug) return alert('Conferma non corrispondente. Organizzazione non eliminata.')
        void (async () => {
          const checks = await Promise.all([
            supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
            supabase.from('structures').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
            supabase.from('event_types').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
            supabase.from('crew_types').select('id', { count: 'exact', head: true }).eq('organization_id', org.id),
            supabase.from('settings').select('key', { count: 'exact', head: true }).eq('organization_id', org.id),
          ])
          const failed = checks.find(result => result.error)
          if (failed?.error) return alert(`Controllo non riuscito: ${failed.error.message}`)
          if (checks.some(result => (result.count ?? 0) > 0)) return alert('Il cliente ha ancora utenti o dati collegati. Disattivalo per impedirne l’accesso; i dati verranno conservati.')
          const { error } = await supabase.from('organizations').delete().eq('id', org.id)
          if (error) return alert(error.message)
          await run(Promise.resolve({ error: null }), 'organizations')
        })()
      }}>Elimina</button>
    </div>)}</div>
  </div>
}

function Utenti({ canManagePlatform }: { canManagePlatform: boolean }) {
  const { profile } = useAuth()
  const run = useRun()
  const activeOrganization = useActiveOrganizationId()
  const users = useCached<Profile[]>(['profiles', canManagePlatform ? 'all' : activeOrganization.data ?? 'none'], async () => {
    let query = supabase.from('profiles').select('*').order('full_name')
    if (!canManagePlatform) {
      if (!activeOrganization.data) return []
      query = query.eq('organization_id', activeOrganization.data)
    }
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as Profile[]
  }, canManagePlatform || !!activeOrganization.data)
  const organizations = useCached<Organization[]>(['organizations', canManagePlatform ? 'all' : activeOrganization.data ?? 'none'], async () => {
    let query = supabase.from('organizations').select('*').order('name')
    if (!canManagePlatform) {
      if (!activeOrganization.data) return []
      query = query.eq('id', activeOrganization.data)
    }
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as Organization[]
  }, canManagePlatform || !!activeOrganization.data)
  const adminStructures = useCached<Structure[]>(['user-admin-structures', canManagePlatform ? 'all' : activeOrganization.data ?? 'none'], async () => {
    let query = supabase.from('structures').select('*').order('name')
    if (!canManagePlatform) {
      if (!activeOrganization.data) return []
      query = query.eq('organization_id', activeOrganization.data)
    }
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as Structure[]
  }, canManagePlatform || !!activeOrganization.data)
  const adminCrews = useCached<Crew[]>(['user-admin-crews', canManagePlatform ? 'all' : activeOrganization.data ?? 'none'], async () => {
    let query = supabase.from('crews').select('*').order('name')
    if (!canManagePlatform) {
      if (!activeOrganization.data) return []
      const { data: structures, error: structureError } = await supabase.from('structures').select('id').eq('organization_id', activeOrganization.data)
      if (structureError) throw structureError
      const structureIds = (structures ?? []).map(s => s.id)
      if (!structureIds.length) return []
      query = query.in('structure_id', structureIds)
    }
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as Crew[]
  }, canManagePlatform || !!activeOrganization.data)
  const events = useCached<Ev[]>(['events', 'user-admin', canManagePlatform ? 'all' : activeOrganization.data ?? 'none'], async () => {
    let query = supabase.from('events').select('*').order('created_at', { ascending: false })
    if (!canManagePlatform) {
      if (!activeOrganization.data) return []
      const { data: structures, error: structureError } = await supabase.from('structures').select('id').eq('organization_id', activeOrganization.data)
      if (structureError) throw structureError
      const structureIds = (structures ?? []).map(s => s.id)
      if (!structureIds.length) return []
      query = query.in('structure_id', structureIds)
    }
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as Ev[]
  }, canManagePlatform || !!activeOrganization.data)
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('operatore')
  const [crew, setCrew] = useState('')
  const [organizationId, setOrganizationId] = useState(profile?.organization_id ?? '')
  useEffect(() => {
    if (activeOrganization.data) setOrganizationId(activeOrganization.data)
  }, [activeOrganization.data])
  const visibleUsers = (users.data ?? []).filter(u => canManagePlatform || u.organization_id === activeOrganization.data)
  const assignments = useCached<{ user_id: string; event_id: string }[]>(['user_events', canManagePlatform ? 'all' : visibleUsers.map(u => u.id).sort().join(',')], async () => {
    let query = supabase.from('user_events').select('*').order('event_id')
    if (!canManagePlatform) {
      const userIds = visibleUsers.map(u => u.id)
      if (!userIds.length) return []
      query = query.in('user_id', userIds)
    }
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as { user_id: string; event_id: string }[]
  }, canManagePlatform || visibleUsers.length > 0)
  const crewsForOrganization = (id: string) => {
    const structureIds = new Set((adminStructures.data ?? []).filter(s => s.organization_id === id).map(s => s.id))
    return (adminCrews.data ?? []).filter(c => !!c.structure_id && structureIds.has(c.structure_id))
  }
  const [search, setSearch] = useState('')

  const create = async () => {
    if (!email || !name || pw.length < 12) return alert('Compila email, nome e password (minimo 12 caratteri)')
    const assignedOrganization = canManagePlatform ? organizationId : activeOrganization.data
    if (!assignedOrganization) return alert('Seleziona un’organizzazione attiva prima di creare l’utente.')
    const { error } = await supabase.functions.invoke('admin-create-user', {
      body: { email, password: pw, full_name: name, role, crew_id: crew || null, organization_id: assignedOrganization },
    })
    if (error) {
      let detail = error.message
      if ('context' in error && error.context instanceof Response) {
        try { detail = (await error.context.clone().json()).error ?? detail } catch { /* Usa il messaggio standard. */ }
      }
      return alert(`Utente non creato: ${detail}. Verifica che la funzione di gestione utenti sia stata pubblicata.`)
    }
    await run(Promise.resolve({ error: null }), 'profiles')
    setEmail(''); setPw(''); setName('')
    alert('Utente creato e abilitato. Comunica le credenziali iniziali in modo sicuro.')
  }

  const setEventAccess = async (userId: string, eventId: string, checked: boolean) => {
    const result = checked
      ? await supabase.from('user_events').upsert({ user_id: userId, event_id: eventId }, { onConflict: 'user_id,event_id' })
      : await supabase.from('user_events').delete().eq('user_id', userId).eq('event_id', eventId)
    if (result.error) return alert(result.error.message)
    await run(Promise.resolve({ error: null }), 'user_events')
  }

  const sendPasswordReset = async (user: Profile) => {
    if (!user.email) return alert('Questo account non ha un’email registrata. Esegui la migrazione SQL e aggiorna il profilo.')
    if (!confirm(`Inviare a ${user.email} il link per scegliere una nuova password?`)) return
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: window.location.origin })
    if (error) alert(error.message)
    else alert(`Link per il reset inviato a ${user.email}.`)
  }

  return (
    <div>
      <h3>Utenti</h3>
      <div className="card">
        <strong>Nuovo utente</strong>
        <p className="muted">Ruolo ed equipaggio definiscono le autorizzazioni operative. Gli eventi si assegnano separatamente a ogni utente.</p>
        <div className="grid2">
          <input placeholder="Nome e cognome" value={name} onChange={e => setName(e.target.value)} />
          <input placeholder="Email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
          <input placeholder="Password iniziale (min. 12)" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} />
          <select value={role} onChange={e => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <select value={crew} onChange={e => setCrew(e.target.value)}>
            <option value="">Nessun equipaggio</option>
            {crewsForOrganization(organizationId).filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {canManagePlatform && <select value={organizationId} onChange={e => setOrganizationId(e.target.value)} aria-label="Organizzazione">
            <option value="">Organizzazione…</option>
            {(organizations.data ?? []).filter(o => o.active).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>}
        </div>
        <button onClick={create}>Crea utente</button>
      </div>
      <div className="user-directory-head"><div><h4>Utenti registrati</h4><p className="muted">Gestisci autorizzazioni, eventi e accesso agli account.</p></div><input aria-label="Cerca utente" placeholder="Cerca per nome o email…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="user-directory">
        {visibleUsers.filter(u => `${u.full_name} ${u.email ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(u => (
          <article key={u.id} className={`user-card ${u.active ? '' : 'is-disabled'}`}>
            <div className="user-card-heading"><div className="user-avatar" aria-hidden="true">{(u.full_name || '?').trim().charAt(0).toLocaleUpperCase()}</div><div className="user-identity"><strong>{u.full_name || '(senza nome)'}</strong><span>{u.email || 'Email non disponibile'}{canManagePlatform ? ` · ${(organizations.data ?? []).find(o => o.id === u.organization_id)?.name ?? 'Senza organizzazione'}` : ''}</span></div><span className={`user-state ${u.active ? 'enabled' : ''}`}>{u.active ? 'Attivo' : 'Disabilitato'}</span></div>
            <div className="user-permissions">
              <label>Ruolo<select value={u.role} disabled={u.id === profile?.id} onChange={e => run(supabase.from('profiles').update({ role: e.target.value }).eq('id', u.id), 'profiles')}>
                {(Object.keys(ROLE_LABEL) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select></label>
              <label>Equipaggio<select value={u.crew_id ?? ''} disabled={profile?.is_platform_admin && u.id === profile.id} onChange={e => run(supabase.from('profiles').update({ crew_id: e.target.value || null }).eq('id', u.id), 'profiles')}>
                <option value="">Nessun equipaggio</option>
                {crewsForOrganization(u.organization_id ?? '').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            </div>
            <div className="user-card-actions">
              <details className="user-event-access">
                <summary>Eventi assegnati <span className="count-badge">{(assignments.data ?? []).filter(a => a.user_id === u.id).length}</span></summary>
                <div className="user-event-options">
                  {(events.data ?? []).filter(event => adminStructures.data?.some(s => s.id === event.structure_id && s.organization_id === u.organization_id)).map(event => {
                    const checked = (assignments.data ?? []).some(a => a.user_id === u.id && a.event_id === event.id)
                    return <label key={event.id}><input type="checkbox" checked={checked} onChange={e => void setEventAccess(u.id, event.id, e.target.checked)} />{event.name} <small>{event.status === 'in_corso' ? 'In corso' : event.status}</small></label>
                  })}
                  {!(events.data ?? []).some(event => adminStructures.data?.some(s => s.id === event.structure_id && s.organization_id === u.organization_id)) && <small>Nessun evento disponibile</small>}
                </div>
              </details>
              <div className="user-actions-row">
                <button className="ghost" disabled={u.id === profile?.id} onClick={() => { const n = window.prompt('Nome', u.full_name); if (n) void run(supabase.from('profiles').update({ full_name: n }).eq('id', u.id), 'profiles') }}>Rinomina</button>
                <button className="ghost" disabled={!u.email} onClick={() => void sendPasswordReset(u)}>Invia reset password</button>
                <button className={u.active ? 'ghost' : ''} disabled={u.id === profile?.id} onClick={() => run(supabase.from('profiles').update({ active: !u.active }).eq('id', u.id), 'profiles')}>{u.active ? 'Disabilita' : 'Riattiva account'}</button>
              </div>
            </div>
          </article>
        ))}
        {(users.data ?? []).length > 0 && !(users.data ?? []).some(u => `${u.full_name} ${u.email ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) && <p className="empty-list">Nessun utente corrisponde alla ricerca.</p>}
      </div>
    </div>
  )
}

function toDataUrl(file: File, max = 1600): Promise<string> {
  return new Promise((res, rej) => {
    if (!file.type.startsWith('image/')) { rej(new Error('Formato non supportato. Scegli un file immagine.')); return }
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      const s = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s)
      const ctx = c.getContext('2d')
      if (!ctx) { URL.revokeObjectURL(url); rej(new Error('Impossibile elaborare questa immagine.')); return }
      ctx.drawImage(img, 0, 0, c.width, c.height)
      URL.revokeObjectURL(url)
      res(c.toDataURL('image/jpeg', 0.8))
    }
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Immagine non supportata dal browser. Prova PNG, JPEG o WebP.')) }
    img.src = url
  })
}

function Generale() {
  const organizationId = useActiveOrganizationId()
  const rd = useRefData()
  const run = useRun()
  const [venue, setVenue] = useState(typeof rd.settings['venue'] === 'string' ? (rd.settings['venue'] as string) : '')
  const save = (key: string, value: unknown) =>
    run(supabase.from('settings').upsert({ key, value, updated_at: new Date().toISOString(), organization_id: organizationId.data }), 'settings')
  return (
    <div>
      <h3>Generale</h3>
      <div className="toolbar">
        <input placeholder="Nome struttura (es. Stadio Comunale)" value={venue} onChange={e => setVenue(e.target.value)} />
        <button onClick={() => save('venue', venue)}>Salva</button>
      </div>
    </div>
  )
}

export default function Impostazioni() {
  const { profile } = useAuth()
  const activeTenant = tenantBasePath().replace(/^\//, '') || profile?.organization_slug || ''
  const isAdmin = profile?.role === 'admin'
  const isPlatformAdmin = !!profile?.is_platform_admin && activeTenant === 'principale'
  const [tab, setTab] = useState<Tab>('spazi')
  const tabs: [Tab, string, boolean][] = [
    ['organizzazioni', 'Clienti', isPlatformAdmin],
    ['strutture', 'Strutture', isAdmin], ['spazi', 'Spazi', true], ['equipaggi', 'Equipaggi', true], ['tipi_eq', 'Tipi equipaggio', isAdmin],
    ['eventi', 'Tipi evento', isAdmin], ['utenti', 'Utenti', isAdmin], ['generale', 'Generale', isAdmin],
  ]
  return (
    <div>
      <h2>Impostazioni</h2>
      <div className="tabs">
        {tabs.filter(t => t[2]).map(([k, label]) => (
          <button key={k} className={tab === k ? '' : 'ghost'} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>
      {tab === 'organizzazioni' && isPlatformAdmin && <Organizzazioni />}
      {tab === 'spazi' && <Spazi />}
      {tab === 'strutture' && isAdmin && <Strutture />}
      {tab === 'equipaggi' && <Equipaggi />}
      {tab === 'tipi_eq' && isAdmin && <TipiEquipaggio />}
      {tab === 'eventi' && isAdmin && <TipiEvento />}
      {tab === 'utenti' && isAdmin && <Utenti canManagePlatform={isPlatformAdmin} />}
      {tab === 'generale' && isAdmin && <Generale />}
    </div>
  )
}
