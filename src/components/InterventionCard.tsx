import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { patchIntervention } from '../lib/actions'
import type { RefData } from '../lib/data'
import { CREW_LABEL, STATUS_LABEL, STATUS_ORDER, TRIAGE_COLORS, TRIAGE_LIST } from '../lib/types'
import type { Intervention, Role, Status, Triage } from '../lib/types'

interface Props { i: Intervention; rd: RefData; all: Intervention[]; role: Role; ownCrew: string | null }

const fromI = (x: Intervention) => ({
  first_name: x.first_name ?? '', last_name: x.last_name ?? '', age: x.age?.toString() ?? '', sex: x.sex ?? '',
  location_note: x.location_note ?? '', notes: x.notes ?? '', outcome: x.outcome ?? '', destination: x.destination ?? '',
})

export default function InterventionCard({ i, rd, all, role, ownCrew }: Props) {
  const [open, setOpen] = useState(false)
  const [f, setF] = useState(fromI(i))
  const [handoverCrew, setHandoverCrew] = useState('')
  const [handoverText, setHandoverText] = useState('')
  const [extraCrews, setExtraCrews] = useState<string[]>(i.crew_ids ?? (i.crew_id ? [i.crew_id] : []))
  const canTriage = role === 'admin' || role === 'co' || role === 'medico'
  const canAssign = role === 'admin'
  const type = rd.types.find(t => t.id === i.event_type_id)
  const crew = rd.crews.find(c => c.id === i.crew_id)
  const patch = (p: Partial<Intervention>) => patchIntervention(i, p, all, role, ownCrew)
  const time = new Date(i.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })

  const save = async () => {
    await patch({
      first_name: f.first_name || null, last_name: f.last_name || null, age: f.age ? Number(f.age) : null,
      sex: f.sex || null, location_note: f.location_note || null, notes: f.notes || null,
      outcome: f.outcome || null, destination: f.destination || null,
    })
    setOpen(false)
  }
  const transfer = async () => {
    if (!handoverCrew) return
    const prior = i.crew_id ? rd.crews.find(c => c.id === i.crew_id)?.name ?? 'Equipaggio' : 'Nessun equipaggio'
    const next = rd.crews.find(c => c.id === handoverCrew)?.name ?? 'Equipaggio'
    const stamp = new Date().toLocaleString('it-IT')
    await patch({ crew_id: handoverCrew, crew_ids: [handoverCrew], status: 'assegnato', notes: `${i.notes ?? ''}${i.notes ? '\n' : ''}[Consegna ${stamp}] ${prior} → ${next}${handoverText ? ` · ${handoverText}` : ''}` })
    setHandoverCrew(''); setHandoverText('')
  }

  return (
    <div className="card" style={{ borderLeft: `8px solid ${i.triage ? TRIAGE_COLORS[i.triage] : '#94a3b8'}` }}>
      <div className="row">
        <strong>
          <span className="dot" style={{ background: type?.color ?? '#64748b' }} />
          #{i.number ?? '…'} · {type?.name ?? 'Tipo n/d'}
        </strong>
        <span className="muted">{time}{i.pending ? ' · ⏳ da inviare' : ''}</span>
      </div>
      <div>
        {[i.first_name, i.last_name].filter(Boolean).join(' ') || 'Paziente n/d'}
        {i.age ? `, ${i.age} anni` : ''}{i.sex ? ` (${i.sex})` : ''}
      </div>
      <div className="muted">📍 {rd.zoneLabel(i.zone_id)}{i.location_note ? ` · ${i.location_note}` : ''}</div>
      <div className="muted">🚑 {(i.crew_ids?.length ? i.crew_ids.map(id => rd.crews.find(c => c.id === id)?.name).filter(Boolean).join(', ') : crew?.name) || 'non assegnato'}</div>

      <div className="controls">
        <select value={i.status} onChange={e => patch({ status: e.target.value as Status })}>
          {STATUS_ORDER.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        {canTriage && (
          <select value={i.triage ?? ''} onChange={e => patch({ triage: e.target.value as Triage })}>
            <option value="" disabled>Codice triage…</option>
            {TRIAGE_LIST.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        {canAssign && (
          <select value={i.crew_id ?? ''} onChange={e => patch({ crew_id: e.target.value || null })}>
            <option value="">Equipaggio…</option>
            {rd.crews.filter(c => c.active).map(c => (
              <option key={c.id} value={c.id}>{c.name} ({CREW_LABEL[c.status]})</option>
            ))}
          </select>
        )}
        <button className="ghost" onClick={() => { setF(fromI(i)); setOpen(!open) }}>{open ? 'Chiudi' : 'Dettagli'}</button>
      </div>

      {open && (
        <div className="details">
          {canAssign && <>
            <label>Equipaggi di supporto<select multiple value={extraCrews} onChange={e => setExtraCrews(Array.from(e.target.selectedOptions, o => o.value))}>
              {rd.crews.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
            <button className="ghost" onClick={() => patch({ crew_ids: extraCrews, crew_id: extraCrews[0] ?? null })}>Salva equipaggi</button>
          </>}
          <h4>Passaggio di consegne</h4>
          <div className="grid2">
            <select value={handoverCrew} onChange={e => setHandoverCrew(e.target.value)}><option value="">Nuovo equipaggio…</option>{rd.crews.filter(c => c.active).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <input placeholder="Nota consegna (es. valutazione, terapia)" value={handoverText} onChange={e => setHandoverText(e.target.value)} />
          </div>
          <button className="ghost" disabled={!handoverCrew} onClick={transfer}>Registra consegna</button>
          <div className="grid2">
            <input placeholder="Nome" value={f.first_name} onChange={set('first_name')} />
            <input placeholder="Cognome" value={f.last_name} onChange={set('last_name')} />
            <input placeholder="Età" type="number" value={f.age} onChange={set('age')} />
            <input placeholder="Sesso (M/F)" value={f.sex} onChange={set('sex')} />
          </div>
          <input placeholder="Dettaglio luogo (fila, posto, cancello…)" value={f.location_note} onChange={set('location_note')} />
          <textarea placeholder="Note cliniche / dinamica" rows={3} value={f.notes} onChange={set('notes')} />
          <div className="grid2">
            <input placeholder="Esito" value={f.outcome} onChange={set('outcome')} />
            <input placeholder="Destinazione (ospedale, PMA…)" value={f.destination} onChange={set('destination')} />
          </div>
          <button onClick={save}>Salva dettagli</button>
        </div>
      )}
    </div>
  )
}
