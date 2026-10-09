import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@supabase/supabase-js'
import { useAuth } from '../auth/AuthContext'
import { all, useCached, useRefData } from '../lib/data'
import { supabase } from '../lib/supabase'
import { ROLE_LABEL } from '../lib/types'
import type { Ev, Profile, Role } from '../lib/types'
import ZoneMap from '../components/ZoneMap'
import { useEventSelection } from '../lib/eventSelection'

type Tab = 'strutture' | 'spazi' | 'eventi' | 'tipi_eq' | 'equipaggi' | 'utenti' | 'generale'
type Res = PromiseLike<{ error: { message: string } | null }>

function useRun() {
  const qc = useQueryClient()
  return async (p: Res, key: string) => {
    const { error } = await p
    if (error) alert(error.message)
    await qc.invalidateQueries({ queryKey: [key] })
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
          await run(supabase.from('zones').insert({ name: name.trim(), structure_id: structureId, parent_id: parent || null, kind, sort: rd.zones.length + 1 }), 'zones')
          setName('')
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
  const rd = useRefData()
  const run = useRun()
  const [name, setName] = useState('')
  return <div>
    <h3>Strutture e planimetrie</h3>
    <p className="muted">Ogni struttura ha una planimetria e i propri spazi. Gli eventi restano collegati alla struttura scelta alla creazione.</p>
    <div className="toolbar"><input placeholder="Nome struttura / stadio" value={name} onChange={e => setName(e.target.value)} />
      <button onClick={async () => {
        if (!name.trim()) return
        await run(supabase.from('structures').insert({ name: name.trim(), map_image: '', active: true }), 'structures')
        setName('')
      }}>Aggiungi struttura</button>
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
        <button onClick={async () => { if (!name.trim()) return; await run(supabase.from('event_types').insert({ name: name.trim(), color, sort: rd.types.length + 1 }), 'event_types'); setName('') }}>Aggiungi</button>
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
  const rd = useRefData()
  const run = useRun()
  const [name, setName] = useState('')
  return (
    <div>
      <h3>Tipi di equipaggio</h3>
      <div className="toolbar">
        <input placeholder="Nome (es. Ambulanza, PMA)" value={name} onChange={e => setName(e.target.value)} />
        <button onClick={async () => { if (!name.trim()) return; await run(supabase.from('crew_types').insert({ name: name.trim() }), 'crew_types'); setName('') }}>Aggiungi</button>
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
        <button onClick={async () => { if (!name.trim() || !structureId) return; await run(supabase.from('crews').insert({ name: name.trim(), structure_id: structureId, crew_type_id: type || null, members: Number(members) || 1 }), 'crews'); setName('') }}>Aggiungi</button>
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

function Utenti() {
  const rd = useRefData()
  const run = useRun()
  const users = useCached<Profile[]>(['profiles'], () => all<Profile>('profiles', 'full_name'))
  const events = useCached<Ev[]>(['events', 'all-admin'], () => all<Ev>('events', 'created_at', false))
  const assignments = useCached<{ user_id: string; event_id: string }[]>(['user_events'], () => all<{ user_id: string; event_id: string }>('user_events', 'event_id'))
  const [email, setEmail] = useState('')
  const [pw, setPw] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('operatore')
  const [crew, setCrew] = useState('')
  const [search, setSearch] = useState('')

  const create = async () => {
    if (!email || !name || pw.length < 8) return alert('Compila email, nome e password (minimo 8 caratteri)')
    const tmp = createClient(import.meta.env.VITE_SUPABASE_URL as string, import.meta.env.VITE_SUPABASE_ANON_KEY as string,
      { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    const { data, error } = await tmp.auth.signUp({ email, password: pw, options: { data: { full_name: name } } })
    if (error || !data.user) return alert(error?.message ?? 'Errore nella creazione')
    await run(supabase.from('profiles').update({ role, crew_id: crew || null, full_name: name, email, active: true }).eq('id', data.user.id), 'profiles')
    setEmail(''); setPw(''); setName('')
    alert('Utente creato. Se non riesce ad accedere, disattiva "Confirm email" in Supabase → Authentication.')
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
    const { error } = await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: `${window.location.origin}/` })
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
          <input placeholder="Password iniziale (min. 8)" type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} />
          <select value={role} onChange={e => setRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
          </select>
          <select value={crew} onChange={e => setCrew(e.target.value)}>
            <option value="">Nessun equipaggio</option>
            {rd.crews.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <button onClick={create}>Crea utente</button>
      </div>
      <div className="user-directory-head"><div><h4>Utenti registrati</h4><p className="muted">Gestisci autorizzazioni, eventi e accesso agli account.</p></div><input aria-label="Cerca utente" placeholder="Cerca per nome o email…" value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="user-directory">
        {(users.data ?? []).filter(u => `${u.full_name} ${u.email ?? ''}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(u => (
          <article key={u.id} className={`user-card ${u.active ? '' : 'is-disabled'}`}>
            <div className="user-card-heading"><div className="user-avatar" aria-hidden="true">{(u.full_name || '?').trim().charAt(0).toLocaleUpperCase()}</div><div className="user-identity"><strong>{u.full_name || '(senza nome)'}</strong><span>{u.email || 'Email non disponibile'}</span></div><span className={`user-state ${u.active ? 'enabled' : ''}`}>{u.active ? 'Attivo' : 'Disabilitato'}</span></div>
            <div className="user-permissions">
              <label>Ruolo<select value={u.role} onChange={e => run(supabase.from('profiles').update({ role: e.target.value }).eq('id', u.id), 'profiles')}>
                {(Object.keys(ROLE_LABEL) as Role[]).map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select></label>
              <label>Equipaggio<select value={u.crew_id ?? ''} onChange={e => run(supabase.from('profiles').update({ crew_id: e.target.value || null }).eq('id', u.id), 'profiles')}>
                <option value="">Nessun equipaggio</option>
                {rd.crews.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></label>
            </div>
            <div className="user-card-actions">
              <details className="user-event-access">
                <summary>Eventi assegnati <span className="count-badge">{(assignments.data ?? []).filter(a => a.user_id === u.id).length}</span></summary>
                <div className="user-event-options">
                  {(events.data ?? []).map(event => {
                    const checked = (assignments.data ?? []).some(a => a.user_id === u.id && a.event_id === event.id)
                    return <label key={event.id}><input type="checkbox" checked={checked} onChange={e => void setEventAccess(u.id, event.id, e.target.checked)} />{event.name} <small>{event.status === 'in_corso' ? 'In corso' : event.status}</small></label>
                  })}
                  {!(events.data ?? []).length && <small>Nessun evento disponibile</small>}
                </div>
              </details>
              <div className="user-actions-row">
                <button className="ghost" onClick={() => { const n = window.prompt('Nome', u.full_name); if (n) void run(supabase.from('profiles').update({ full_name: n }).eq('id', u.id), 'profiles') }}>Rinomina</button>
                <button className="ghost" disabled={!u.email} onClick={() => void sendPasswordReset(u)}>Invia reset password</button>
                <button className={u.active ? 'ghost' : ''} onClick={() => run(supabase.from('profiles').update({ active: !u.active }).eq('id', u.id), 'profiles')}>{u.active ? 'Disabilita' : 'Riattiva account'}</button>
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
  const rd = useRefData()
  const run = useRun()
  const [venue, setVenue] = useState(typeof rd.settings['venue'] === 'string' ? (rd.settings['venue'] as string) : '')
  const save = (key: string, value: unknown) =>
    run(supabase.from('settings').upsert({ key, value, updated_at: new Date().toISOString() }), 'settings')
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
  const isAdmin = profile?.role === 'admin'
  const [tab, setTab] = useState<Tab>('spazi')
  const tabs: [Tab, string, boolean][] = [
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
      {tab === 'spazi' && <Spazi />}
      {tab === 'strutture' && isAdmin && <Strutture />}
      {tab === 'equipaggi' && <Equipaggi />}
      {tab === 'tipi_eq' && isAdmin && <TipiEquipaggio />}
      {tab === 'eventi' && isAdmin && <TipiEvento />}
      {tab === 'utenti' && isAdmin && <Utenti />}
      {tab === 'generale' && isAdmin && <Generale />}
    </div>
  )
}
