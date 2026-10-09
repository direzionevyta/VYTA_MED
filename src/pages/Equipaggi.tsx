import { useAuth } from '../auth/AuthContext'
import { useInterventions, useRefData } from '../lib/data'
import { useEventSelection } from '../lib/eventSelection'
import { setCrewStatus } from '../lib/actions'
import { ACTIVE, CREW_LABEL } from '../lib/types'
import type { CrewStatus } from '../lib/types'

const COL: Record<CrewStatus, string> = { disponibile: '#22c55e', impegnato: '#ef4444', non_disponibile: '#94a3b8' }

export default function Equipaggi() {
  const { profile } = useAuth()
  const selection = useEventSelection()
  const selectedEvent = selection.selectedEvent
  const rd = useRefData(selectedEvent?.structure_id)
  const { items } = useInterventions(selectedEvent?.id, profile?.role, profile?.crew_id ?? null)
  const canEdit = profile?.role === 'admin' || profile?.role === 'co'
  const crews = rd.crews.filter(c => c.active && (profile?.role === 'admin' || profile?.role === 'co' || c.id === profile?.crew_id))

  if (selection.loading) return <p>Caricamento…</p>
  if (!selectedEvent) return <p>{selection.events.length ? 'Scegli l’evento dal menu in alto.' : 'Nessun evento assegnato o in corso.'}</p>

  return (
    <div>
      <h2>Equipaggi</h2>
      <div className="chips">
        {(Object.keys(CREW_LABEL) as CrewStatus[]).map(s => (
          <span key={s} className="chip" style={{ background: COL[s], color: '#fff' }}>
            {CREW_LABEL[s]}: {crews.filter(c => c.status === s).length}
          </span>
        ))}
      </div>
      <div className="cards">
        {crews.map(c => {
          const mine = items.filter(i => i.crew_id === c.id && ACTIVE.includes(i.status))
          return (
            <div key={c.id} className="card" style={{ borderLeft: `8px solid ${COL[c.status]}` }}>
              <strong>{c.name}</strong>
              <div className="muted">{rd.crewTypes.find(t => t.id === c.crew_type_id)?.name ?? 'Tipo n/d'} · {c.members} persone</div>
              {c.base_zone_id && <div className="muted">📍 Base: {rd.zoneLabel(c.base_zone_id)}</div>}
              {canEdit ? (
                <select value={c.status} onChange={e => setCrewStatus(c.id, e.target.value as CrewStatus)}>
                  {(Object.keys(CREW_LABEL) as CrewStatus[]).map(s => <option key={s} value={s}>{CREW_LABEL[s]}</option>)}
                </select>
              ) : <div>{CREW_LABEL[c.status]}</div>}
              {mine.map(i => <div key={i.id} className="muted">→ #{i.number ?? '…'} {rd.types.find(t => t.id === i.event_type_id)?.name} · {rd.zoneLabel(i.zone_id)}</div>)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
