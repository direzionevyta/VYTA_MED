import { useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { useCached, useRefData } from '../lib/data'
import { useEventSelection } from '../lib/eventSelection'
import { supabase } from '../lib/supabase'
import type { EventPost } from '../lib/types'

const tvMode = new URLSearchParams(window.location.search).get('schermo') === '1'

export default function Schieramento() {
  const { profile } = useAuth()
  const { selectedEvent, events } = useEventSelection()
  const eventId = selectedEvent?.id ?? ''
  const rd = useRefData(selectedEvent?.structure_id)
  const qc = useQueryClient()
  const [zoneId, setZoneId] = useState('')
  const [crewId, setCrewId] = useState('')
  const [saving, setSaving] = useState(false)
  const [clock, setClock] = useState(() => new Date())
  useEffect(() => {
    if (!tvMode) return
    const interval = window.setInterval(() => setClock(new Date()), 30_000)
    return () => window.clearInterval(interval)
  }, [])
  useEffect(() => {
    if (!tvMode || !eventId) return
    const interval = window.setInterval(() => { void qc.invalidateQueries({ queryKey: ['event_posts', eventId] }) }, 5_000)
    return () => window.clearInterval(interval)
  }, [eventId, qc])
  const canEdit = profile?.role === 'admin' || profile?.role === 'co'
  const postsQuery = useCached<EventPost[]>(['event_posts', eventId], async () => {
    const { data, error } = await supabase.from('event_posts').select('*').eq('event_id', eventId).order('post_number')
    if (error) throw error
    return (data ?? []) as EventPost[]
  }, !!eventId)
  const posts = postsQuery.data ?? []
  const activeZones = rd.zones.filter(z => z.active).sort((a, b) => rd.zoneLabel(a.id).localeCompare(rd.zoneLabel(b.id)))
  const crews = rd.crews.filter(c => c.active)
  const assignedCrewIds = new Set(posts.flatMap(p => p.crew_id ? [p.crew_id] : []))
  const unassignedCrews = crews.filter(c => !assignedCrewIds.has(c.id))
  const indexedPosts = useMemo(() => posts.map(p => ({
    post: p,
    zone: rd.zones.find(z => z.id === p.zone_id),
    crew: rd.crews.find(c => c.id === p.crew_id),
  })), [posts, rd.zones, rd.crews])
  const crewDisplay = (crewId: string | null) => {
    const crew = crews.find(c => c.id === crewId)
    if (!crew) return 'Da assegnare'
    const type = rd.crewTypes.find(t => t.id === crew.crew_type_id)?.name
    return type ? `${crew.name} · ${type}` : crew.name
  }

  const refresh = () => { void qc.invalidateQueries({ queryKey: ['event_posts', eventId] }) }
  const addPost = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!zoneId || !crewId || !eventId) return
    setSaving(true)
    const nextNumber = Math.max(0, ...posts.map(p => p.post_number)) + 1
    const { error } = await supabase.from('event_posts').insert({ event_id: eventId, zone_id: zoneId, crew_id: crewId, post_number: nextNumber })
    setSaving(false)
    if (error) { alert(error.message.includes('unique') ? 'Questa postazione o questo equipaggio è già assegnato nell’evento.' : error.message); return }
    setZoneId(''); setCrewId(''); refresh()
  }
  const changeCrew = async (post: EventPost, nextCrew: string) => {
    const { error } = await supabase.from('event_posts').update({ crew_id: nextCrew || null }).eq('id', post.id)
    if (error) alert(error.message.includes('unique') ? 'Questo equipaggio è già assegnato a un’altra postazione.' : error.message)
    else refresh()
  }
  const removePost = async (post: EventPost) => {
    if (!confirm(`Rimuovere la postazione ${post.post_number} da questo evento?`)) return
    const { error } = await supabase.from('event_posts').delete().eq('id', post.id)
    if (error) alert(error.message)
    else refresh()
  }

  if (!selectedEvent) return <div className="event-required"><h2>Scegli un evento</h2><p>Seleziona dal menu in alto l’evento da programmare o mostrare sullo schermo.</p>{!events.length && <p className="muted">Non ci sono eventi in programmazione o in corso assegnati al tuo account.</p>}</div>

  const assignmentRows = indexedPosts.map(({ post, zone }) => (
    <div className="deployment-row" key={post.id}>
      <span className="deployment-bubble">{post.post_number}</span>
      <div className="deployment-row-info"><strong>Postazione {post.post_number}</strong><span>{zone ? rd.zoneLabel(zone.id) : 'Spazio non disponibile'}</span></div>
      {tvMode ? <strong className="deployment-crew-name">{crewDisplay(post.crew_id)}</strong> : canEdit ? <select aria-label={`Squadra della postazione ${post.post_number}`} value={post.crew_id ?? ''} onChange={e => void changeCrew(post, e.target.value)}>
        <option value="">Da assegnare</option>{crews.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select> : <strong className="deployment-crew-name">{crewDisplay(post.crew_id)}</strong>}
      {!tvMode && canEdit && <button className="ghost" onClick={() => void removePost(post)}>Rimuovi</button>}
    </div>
  ))

  const mapAndRoster = <div className="deployment-layout">
    {rd.mapImage ? <div className="deployment-map" aria-label={`Planimetria ${selectedEvent.name}`}>
      <img src={rd.mapImage} alt={`Planimetria ${selectedEvent.venue ?? selectedEvent.name}`} />
      {indexedPosts.map(({ post, zone, crew }) => zone?.map_x != null && zone.map_y != null && <div className="deployment-pin" key={post.id} style={{ left: `${zone.map_x}%`, top: `${zone.map_y}%` }}>
        <span className="deployment-pin-number">{post.post_number}</span><span className="deployment-pin-label">{crew?.name ?? 'Da assegnare'}</span>
      </div>)}
    </div> : <div className="deployment-map-empty">Carica la planimetria in Impostazioni → Strutture per visualizzare le postazioni sulla mappa.</div>}
    <aside className="deployment-roster"><div className="deployment-roster-title"><strong>Postazioni</strong><span>{posts.length}</span></div>
      {assignmentRows.length ? assignmentRows : <p className="muted">Nessuna postazione programmata per questo evento.</p>}
    </aside>
  </div>

  if (tvMode) return <section className="deployment-tv">
    <header className="deployment-tv-header"><div><span className="eyebrow">SCHIERAMENTO EQUIPAGGI</span><h1>{selectedEvent.name}</h1><p>{selectedEvent.venue ?? ''} · {selectedEvent.status === 'preparazione' ? 'Programmazione' : 'Evento in corso'}</p></div><div className="deployment-tv-controls"><span>{clock.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span><button className="ghost" onClick={() => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen?.() }}>Schermo intero</button></div></header>
    {mapAndRoster}
    <footer className="deployment-tv-footer">Planimetria riferita a questo evento · Aggiornamento in tempo reale</footer>
  </section>

  return <div className="deployment-page">
    <div className="row deployment-title"><div><h2>Schieramento equipaggi</h2><p className="muted">Evento: <strong>{selectedEvent.name}</strong> · Struttura: <strong>{rd.structures.find(s => s.id === selectedEvent.structure_id)?.name ?? selectedEvent.venue ?? '—'}</strong></p></div><button className="ghost" onClick={() => window.open(`${window.location.origin}/schieramento?schermo=1`, '_blank', 'noopener,noreferrer')}>Apri vista TV ↗</button></div>
    {selectedEvent.status === 'preparazione' && <div className="deployment-preparing"><strong>Programmazione in anticipo</strong><span>Le assegnazioni sono salvate solo su questo evento. La vista TV mostra subito gli aggiornamenti.</span></div>}
    {canEdit && <form className="deployment-form" onSubmit={addPost}><label>Postazione / spazio<select required value={zoneId} onChange={e => setZoneId(e.target.value)}><option value="">Scegli uno spazio…</option>{activeZones.filter(z => !posts.some(p => p.zone_id === z.id)).map(z => <option key={z.id} value={z.id}>{rd.zoneLabel(z.id)}</option>)}</select></label><label>Equipaggio<select required value={crewId} onChange={e => setCrewId(e.target.value)}><option value="">Scegli un equipaggio…</option>{unassignedCrews.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><button disabled={saving || !zoneId || !crewId}>{saving ? 'Assegnazione…' : 'Assegna postazione'}</button></form>}
    {postsQuery.error && <p className="err">Impossibile caricare lo schieramento. Verifica di aver eseguito la migrazione SQL per le postazioni evento.</p>}
    {mapAndRoster}
    <p className="muted">Per spostare un punto sulla planimetria, modifica la posizione dello spazio in Impostazioni → Spazi.</p>
  </div>
}
