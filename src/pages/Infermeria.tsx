import { useInterventions, useRefData } from '../lib/data'
import { useEventSelection } from '../lib/eventSelection'
import { useAuth } from '../auth/AuthContext'
import { ACTIVE } from '../lib/types'
import InterventionCard from '../components/InterventionCard'

export default function Infermeria() {
  const { profile } = useAuth()
  const selection = useEventSelection()
  const event = selection.selectedEvent
  const rd = useRefData(event?.structure_id)
  const { items } = useInterventions(event?.id, profile?.role, profile?.crew_id ?? null)
  if (!profile) return null
  if (selection.loading) return <p>Caricamento…</p>
  if (!event) return <p>{selection.events.length ? 'Scegli l’evento dal menu in alto per aprire l’infermeria.' : 'Nessun evento assegnato o in corso.'}</p>
  const patients = items.filter(i => ACTIVE.includes(i.status))
  return <div>
    <h2>Infermeria · {event.name}</h2>
    <div className="chips">
      <span className="chip">In carico: {patients.length}</span>
      <span className="chip">In trattamento: {patients.filter(i => i.status === 'in_trattamento').length}</span>
      <span className="chip">In trasporto: {patients.filter(i => i.status === 'in_trasporto').length}</span>
    </div>
    <p className="muted">Apri i dettagli per aggiornare triage, note cliniche, esito e destinazione; il passaggio tra equipaggi resta nella scheda paziente.</p>
    <div className="cards">{patients.map(i => <InterventionCard key={i.id} i={i} rd={rd} all={items} role={profile.role} ownCrew={profile.crew_id} />)}</div>
    {!patients.length && <p className="muted">Nessun paziente attualmente in carico.</p>}
  </div>
}
