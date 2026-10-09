import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useRefData } from '../lib/data'
import { useEventSelection } from '../lib/eventSelection'
import { createIntervention } from '../lib/actions'
import ZoneMap from '../components/ZoneMap'

export default function Nuovo() {
  const { profile, session } = useAuth()
  const nav = useNavigate()
  const selection = useEventSelection()
  const [typeId, setTypeId] = useState('')
  const [zoneId, setZoneId] = useState('')
  const [showMap, setShowMap] = useState(false)
  const [busy, setBusy] = useState(false)
  const [f, setF] = useState({ first_name: '', last_name: '', age: '', sex: '', location_note: '', notes: '' })
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })

  if (!profile || !session) return null
  if (selection.loading) return <p>Caricamento…</p>
  const selectedEvent = selection.selectedEvent
  const rd = useRefData(selectedEvent?.structure_id)
  if (!selectedEvent) return <p>{selection.events.length ? 'Scegli l’evento dal menu in alto prima di registrare un intervento.' : 'Nessun evento assegnato o in corso.'}</p>
  if (selectedEvent.status === 'preparazione') return <div className="event-required"><strong>Evento in programmazione</strong><p>La registrazione degli interventi sarà disponibile quando l’evento verrà avviato.</p><Link className="ghost-link" to="/schieramento">Vai allo schieramento</Link></div>

  const home = profile.role === 'operatore' ? '/operatore' : '/co'
  const zones = rd.zones.filter(z => z.active).map(z => ({ id: z.id, label: rd.zoneLabel(z.id) })).sort((a, b) => a.label.localeCompare(b.label))

  const submit = async () => {
    if (!typeId) return alert('Seleziona il tipo di evento')
    if (!zoneId) return alert('Seleziona lo spazio')
    setBusy(true)
    await createIntervention({
      event_id: selectedEvent.id, event_type_id: typeId, zone_id: zoneId,
      location_note: f.location_note || null, first_name: f.first_name || null, last_name: f.last_name || null,
      age: f.age ? Number(f.age) : null, sex: f.sex || null, notes: f.notes || null,
      crew_id: profile.crew_id, status: profile.crew_id ? 'sul_posto' : 'nuovo', created_by: session.user.id,
    })
    nav(home)
  }

  return (
    <div className="form">
      <h2>Nuovo intervento</h2>
      <h4>Tipo di evento</h4>
      <div className="typebtns">
        {rd.types.filter(t => t.active).map(t => (
          <button key={t.id} className={typeId === t.id ? 'type sel' : 'type'} style={{ borderColor: t.color }} onClick={() => setTypeId(t.id)}>
            {t.name}
          </button>
        ))}
      </div>
      <h4>Spazio</h4>
      <select value={zoneId} onChange={e => setZoneId(e.target.value)}>
        <option value="">Seleziona lo spazio…</option>
        {zones.map(z => <option key={z.id} value={z.id}>{z.label}</option>)}
      </select>
      {rd.mapImage && <button className="ghost" onClick={() => setShowMap(!showMap)}>{showMap ? 'Nascondi mappa' : 'Scegli sulla mappa'}</button>}
      {showMap && <ZoneMap image={rd.mapImage} zones={rd.zones} selected={zoneId} onPick={setZoneId} />}
      <input placeholder="Dettaglio luogo (fila, posto, cancello…)" value={f.location_note} onChange={set('location_note')} />
      <h4>Paziente</h4>
      <div className="grid2">
        <input placeholder="Nome" value={f.first_name} onChange={set('first_name')} />
        <input placeholder="Cognome" value={f.last_name} onChange={set('last_name')} />
        <input placeholder="Età" type="number" value={f.age} onChange={set('age')} />
        <input placeholder="Sesso (M/F)" value={f.sex} onChange={set('sex')} />
      </div>
      <textarea placeholder="Note (dinamica, sintomi…)" rows={3} value={f.notes} onChange={set('notes')} />
      <button disabled={busy} onClick={submit}>Registra intervento</button>
    </div>
  )
}
