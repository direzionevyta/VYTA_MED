import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useInterventions, useRefData } from '../lib/data'
import { useEventSelection } from '../lib/eventSelection'
import { ACTIVE, TRIAGE_COLORS, TRIAGE_LIST } from '../lib/types'
import InterventionCard from '../components/InterventionCard'
import ZoneMap from '../components/ZoneMap'
import CreateEventDialog from '../components/CreateEventDialog'
import { useCached } from '../lib/data'
import { supabase } from '../lib/supabase'
import { STATUS_LABEL } from '../lib/types'
import type { Intervention, Status } from '../lib/types'

const RANK: Record<string, number> = { rosso: 4, giallo: 3, verde: 2, bianco: 1 }
type Activity = { id: number; event_id: string; intervention_id: string | null; actor_label: string; action: string; details: Record<string, unknown>; created_at: string }

function useEventActivity(eventId: string) {
  return useCached<Activity[]>(['event_activity', eventId], async () => {
    const { data, error } = await supabase.from('event_activity').select('*').eq('event_id', eventId).order('created_at', { ascending: false }).limit(12)
    if (error) throw error
    return (data ?? []) as Activity[]
  }, !!eventId)
}

function activityText(a: Activity, rd: ReturnType<typeof useRefData>, interventions: Intervention[]) {
  const details = a.details ?? {}
  const intervention = interventions.find(item => item.id === a.intervention_id)
  const number = intervention?.number ?? details.numero
  const ref = number != null ? `Intervento #${number}` : 'Intervento'
  const status = (v: unknown) => STATUS_LABEL[String(v) as Status] ?? String(v ?? '—')
  const crewNames = (v: unknown) => Array.isArray(v) ? v.filter(Boolean).map(id => rd.crews.find(c => c.id === id)?.name ?? 'Equipaggio').join(', ') || 'nessun equipaggio' : 'nessun equipaggio'
  const zoneName = (v: unknown) => typeof v === 'string' ? rd.zoneLabel(v) : '—'
  switch (a.action) {
    case 'evento_aperto': return `Evento aperto: ${String(details.nome ?? '')}`
    case 'stato_evento': return `Stato evento: ${String(details.da ?? '')} → ${String(details.a ?? '')}`
    case 'intervento_aperto': return `${ref} aperto${details.triage ? ` · triage ${String(details.triage)}` : ''}${details.zona_id ? ` · ${zoneName(details.zona_id)}` : ''}`
    case 'stato_intervento': return `${ref}: ${status(details.da)} → ${status(details.a)}`
    case 'equipaggi_aggiornati': return `${ref}: equipaggi ${crewNames(details.da)} → ${crewNames(details.a)}`
    case 'passaggio_consegne': return `${ref}: passaggio consegne ${crewNames(details.da)} → ${crewNames(details.a)}`
    case 'zona_aggiornata': return `${ref}: zona ${zoneName(details.da)} → ${zoneName(details.a)}`
    case 'triage_aggiornato': return `${ref}: triage ${String(details.da ?? '—')} → ${String(details.a ?? '—')}`
    default: return 'Aggiornamento operativo'
  }
}

export default function CO() {
  const { profile } = useAuth()
  const qc = useQueryClient()
  const selection = useEventSelection()
  const events = selection.events
  const selectedEvent = selection.selectedEvent
  const rd = useRefData(selectedEvent?.structure_id)
  const { items } = useInterventions(selectedEvent?.id, profile?.role, profile?.crew_id ?? null)
  const activityQuery = useEventActivity(selectedEvent?.id ?? '')
  const [view, setView] = useState<'elenco' | 'mappa'>('elenco')
  const [filter, setFilter] = useState<'attivi' | 'tutti'>('attivi')
  const [zone, setZone] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  if (!profile) return null
  const canEvent = profile.role === 'admin'

  if (selection.loading) return <p>Caricamento…</p>
  if (!events.length) {
    return (
      <div>
        <h2>Nessun evento in corso</h2>
        {canEvent
          ? <button onClick={() => setShowCreate(true)}>Crea evento</button>
          : <p className="muted">Attendi che la Centrale Operativa apra un evento.</p>}
        {canEvent && <CreateEventDialog open={showCreate} onClose={() => setShowCreate(false)} />}
      </div>
    )
  }
  if (!selectedEvent) return <div className="event-required"><h2>Scegli l’evento da seguire</h2><p>Seleziona l’evento dal menu in alto per aprire la Centrale Operativa.</p></div>
  if (selectedEvent.status === 'preparazione') return <div className="event-required">
    <p className="eyebrow">EVENTO IN PROGRAMMAZIONE</p><h2>{selectedEvent.name}</h2>
    <p>Lo schieramento può essere preparato in anticipo. Gli interventi operativi si abiliteranno quando l’evento verrà avviato.</p>
    <div className="toolbar"><Link className="ghost-link" to="/schieramento">Apri schieramento equipaggi</Link>{canEvent && <button onClick={async () => {
      if (!confirm(`Avviare l’evento “${selectedEvent.name}” adesso?`)) return
      const { error } = await supabase.from('events').update({ status: 'in_corso', starts_at: new Date().toISOString() }).eq('id', selectedEvent.id)
      if (error) alert(error.message)
      else await qc.invalidateQueries()
    }}>Avvia evento</button>}</div>
  </div>

  const active = items.filter(i => ACTIVE.includes(i.status))
  const counts: Record<string, number> = {}
  active.forEach(i => { if (i.zone_id) counts[i.zone_id] = (counts[i.zone_id] ?? 0) + 1 })
  const toAssign = active.filter(i => !i.crew_id).length
  const assignedCrewIds = new Set(active.flatMap(i => i.crew_ids?.length ? i.crew_ids : i.crew_id ? [i.crew_id] : []))
  const availableCrews = rd.crews.filter(c => c.active && c.status === 'disponibile' && !assignedCrewIds.has(c.id)).length
  const shown = items
    .filter(i => (filter === 'tutti' || ACTIVE.includes(i.status)) && (!zone || i.zone_id === zone))
    .sort((a, b) => {
      const aa = ACTIVE.includes(a.status) ? 0 : 1
      const bb = ACTIVE.includes(b.status) ? 0 : 1
      if (aa !== bb) return aa - bb
      const r = (RANK[b.triage ?? ''] ?? 0) - (RANK[a.triage ?? ''] ?? 0)
      return r !== 0 ? r : b.created_at.localeCompare(a.created_at)
    })

  return (
    <div>
      <h2>Centrale Operativa · {selectedEvent.name}</h2>
      {canEvent && <div className="toolbar"><button onClick={() => setShowCreate(true)}>+ Apri altro evento</button></div>}
      <section className="ops-summary" aria-label="Riepilogo operativo">
        <div className="ops-metric"><span>Interventi attivi</span><strong>{active.length}</strong></div>
        <div className={`ops-metric ${toAssign ? 'needs-attention' : ''}`}><span>Da assegnare</span><strong>{toAssign}</strong></div>
        <div className="ops-metric"><span>In infermeria</span><strong>{active.filter(i => i.status === 'in_trattamento').length}</strong></div>
        <div className="ops-metric"><span>In trasporto</span><strong>{active.filter(i => i.status === 'in_trasporto').length}</strong></div>
        <div className="ops-metric"><span>Equipaggi disponibili</span><strong>{availableCrews}</strong></div>
      </section>
      <div className="chips">
        <span className="chip">In corso: {active.length}</span>
        <span className="chip warn">Da assegnare: {toAssign}</span>
        {TRIAGE_LIST.slice().reverse().map(t => (
          <span key={t} className="chip" style={{ background: TRIAGE_COLORS[t] }}>
            {t}: {active.filter(i => i.triage === t).length}
          </span>
        ))}
      </div>
      <div className="toolbar">
        <button className={view === 'elenco' ? '' : 'ghost'} onClick={() => setView('elenco')}>Elenco</button>
        <button className={view === 'mappa' ? '' : 'ghost'} onClick={() => setView('mappa')}>Mappa</button>
        <select value={filter} onChange={e => setFilter(e.target.value as 'attivi' | 'tutti')}>
          <option value="attivi">Solo in corso</option>
          <option value="tutti">Tutti</option>
        </select>
        {zone && <button className="ghost" onClick={() => setZone('')}>Filtro: {rd.zoneLabel(zone)} ✕</button>}
      </div>
      {view === 'mappa' && <ZoneMap image={rd.mapImage} zones={rd.zones} counts={counts} selected={zone} onPick={setZone} />}
      <div className="cards">
        {shown.map(i => <InterventionCard key={i.id} i={i} rd={rd} all={items} role={profile.role} ownCrew={profile.crew_id} />)}
        {shown.length === 0 && <p className="muted">Nessun intervento.</p>}
      </div>
      <section className="activity-panel">
        <div className="activity-heading"><div><h3>Diario operativo</h3><p className="muted">Ultimi aggiornamenti registrati per questo evento.</p></div><span className="count-badge">{activityQuery.data?.length ?? 0}</span></div>
        {activityQuery.isLoading ? <p className="muted">Caricamento del diario…</p> : activityQuery.data?.length ? <ol className="activity-list">{activityQuery.data.map(a => (
          <li key={a.id} className="activity-item"><span className="activity-marker" /><div className="activity-copy"><strong>{activityText(a, rd, items)}</strong><span>{a.actor_label} · {new Date(a.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></div></li>
        ))}</ol> : <p className="muted">Il diario inizierà a popolarsi con gli eventi registrati dopo l’attivazione della funzione.</p>}
      </section>
      {canEvent && <CreateEventDialog open={showCreate} onClose={() => setShowCreate(false)} />}
    </div>
  )
}
