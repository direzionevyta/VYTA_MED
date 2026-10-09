import { useState } from 'react'
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
      <div className="cards">
        {shown.map(i => <InterventionCard key={i.id} i={i} rd={rd} all={items} role={profile.role} ownCrew={profile.crew_id} />)}
        {shown.length === 0 && <p className="muted">Nessun intervento assegnato.</p>}
      </div>
    </div>
  )
}
