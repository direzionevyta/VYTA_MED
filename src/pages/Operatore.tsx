import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useCached } from '../lib/data'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useInterventions, useRefData } from '../lib/data'
import { useEventSelection } from '../lib/eventSelection'
import { setCrewStatus } from '../lib/actions'
import { ACTIVE, CREW_LABEL } from '../lib/types'
import type { CrewStatus } from '../lib/types'
import InterventionCard from '../components/InterventionCard'

export default function Operatore() {
  const { profile } = useAuth()
  const nav = useNavigate()
  const selection = useEventSelection()
  const selectedEvent = selection.selectedEvent
  const rd = useRefData(selectedEvent?.structure_id)
  const { items } = useInterventions(selectedEvent?.id, profile?.role, profile?.crew_id ?? null)
  const [all, setAll] = useState(false)
  const [message, setMessage] = useState('')
  const qc = useQueryClient()
  const messages = useCached<{ id: string; body: string; sender_id: string; created_at: string }[]>(['event_messages', selectedEvent?.id ?? 'none'], async () => {
    if (!selectedEvent?.id) return []
    const { data, error } = await supabase.from('event_messages').select('*').eq('event_id', selectedEvent.id).order('created_at', { ascending: false }).limit(30)
    if (error) throw error
    return data ?? []
  }, !!selectedEvent?.id)
  if (!profile) return null
  const mine = rd.crews.find(c => c.id === profile.crew_id)
  const shown = items.filter(i => all || ACTIVE.includes(i.status))

  if (selection.loading) return <p>Caricamento…</p>
  if (!selectedEvent) return <p>{selection.events.length ? 'Scegli l’evento dal menu in alto per vedere gli interventi.' : 'Nessun evento assegnato o in corso.'}</p>

  return (
    <div>
      <h2>{selectedEvent.name}</h2>
      {mine && (
        <div className="card">
          <strong>Il mio equipaggio: {mine.name}</strong>
          <select value={mine.status} onChange={e => setCrewStatus(mine.id, e.target.value as CrewStatus)}>
            {(Object.keys(CREW_LABEL) as CrewStatus[]).map(s => <option key={s} value={s}>{CREW_LABEL[s]}</option>)}
          </select>
        </div>
      )}
      <div className="toolbar">
        <button onClick={() => nav('/nuovo')}>+ Nuovo intervento</button>
        <label><input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} /> mostra conclusi</label>
      </div>
      <section className="activity-panel">
        <h3>Messaggi con la Centrale Operativa</h3>
        <form className="toolbar" onSubmit={async e => {
          e.preventDefault(); const body = message.trim(); if (!body) return
          const { error } = await supabase.from('event_messages').insert({ event_id: selectedEvent.id, body })
          if (error) { alert(error.message); return }
          setMessage(''); await qc.invalidateQueries({ queryKey: ['event_messages', selectedEvent.id] })
        }}><input aria-label="Messaggio alla Centrale Operativa" placeholder="Scrivi alla Centrale Operativa…" maxLength={2000} value={message} onChange={e => setMessage(e.target.value)} /><button disabled={!message.trim()}>Invia</button></form>
        {messages.data?.length ? <ol className="activity-list">{messages.data.map(m => <li className="activity-item" key={m.id}><span className="activity-marker" /><div className="activity-copy"><strong>{m.body}</strong><span>{m.sender_id === profile.id ? 'Tu' : 'Centrale Operativa'} · {new Date(m.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</span></div></li>)}</ol> : <p className="muted">Nessun messaggio.</p>}
      </section>
      <div className="cards">
        {shown.map(i => <InterventionCard key={i.id} i={i} rd={rd} all={items} role={profile.role} ownCrew={profile.crew_id} />)}
        {shown.length === 0 && <p className="muted">Nessun intervento assegnato.</p>}
      </div>
    </div>
  )
}
