import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../auth/AuthContext'
import { useActiveOrganizationId, useCached, useInterventions, useRefData } from '../lib/data'
import { buildReport } from '../lib/report'
import { supabase } from '../lib/supabase'
import { ACTIVE, STATUS_LABEL, TRIAGE_COLORS } from '../lib/types'
import type { Ev } from '../lib/types'
import CreateEventDialog from '../components/CreateEventDialog'

export default function Archivio() {
  const { profile } = useAuth()
  const organizationId = useActiveOrganizationId()
  const qc = useQueryClient()
  const evs = useCached<Ev[]>(['events', 'visible', organizationId.data ?? 'none', profile?.role ?? 'anon', profile?.crew_id ?? 'none'], async () => {
    if (!organizationId.data) return []
    const { data: structures, error: structureError } = await supabase.from('structures').select('id').eq('organization_id', organizationId.data)
    if (structureError) throw structureError
    const structureIds = (structures ?? []).map(s => s.id)
    if (!structureIds.length) return []
    let q = supabase.from('events').select('*').order('created_at', { ascending: false })
      .in('structure_id', structureIds)
    if (profile?.role !== 'admin' && profile?.role !== 'co') {
      if (!profile?.crew_id) return []
      const { data: assigned, error: assignmentError } = await supabase.from('interventions').select('event_id')
        .or(`crew_id.eq.${profile.crew_id},crew_ids.cs.{${profile.crew_id}}`)
      if (assignmentError) throw assignmentError
      const ids = [...new Set((assigned ?? []).map(x => x.event_id as string))]
      if (!ids.length) return []
      q = q.in('id', ids)
    }
    const { data, error } = await q
    if (error) throw error
    return (data ?? []) as Ev[]
  }, !!organizationId.data)
  const [sel, setSel] = useState('')
  const [names, setNames] = useState(false)
  const [onlyClosed, setOnlyClosed] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const list = evs.data ?? []
  const current = sel || list.find(e => e.status === 'in_corso')?.id || list[0]?.id || ''
  const ev = list.find(e => e.id === current)
  const rd = useRefData(ev?.structure_id)
  const { items } = useInterventions(current || null, profile?.role, profile?.crew_id ?? null)
  const canEvent = profile?.role === 'admin'

  const refresh = () => { void qc.invalidateQueries() }
  const end = async () => {
    if (!ev) return
    const open = items.filter(i => ACTIVE.includes(i.status)).length
    if (!confirm(`Concludere "${ev.name}"?${open ? `\nAttenzione: ci sono ${open} interventi ancora in corso.` : ''}`)) return
    const { error } = await supabase.from('events').update({ status: 'concluso', ends_at: new Date().toISOString() }).eq('id', ev.id)
    if (error) alert(error.message)
    refresh()
  }
  const make = () => buildReport({ event: ev as Ev, items, rd, names, onlyClosed })

  return (
    <div>
      <h2>Archivio storico e Report</h2>
      <div className="toolbar">
        <select value={current} onChange={e => setSel(e.target.value)}>
          {list.map(e => <option key={e.id} value={e.id}>{e.name} · {e.status.replace('_', ' ')} · {new Date(e.created_at).toLocaleDateString('it-IT')}</option>)}
        </select>
        {canEvent && <button onClick={() => setShowCreate(true)}>Nuovo evento</button>}
        {canEvent && ev?.status === 'in_corso' && <button className="danger" onClick={end}>Concludi evento</button>}
      </div>
      {!ev && <p className="muted">Nessun evento in archivio.</p>}
      {ev && (
        <>
          <div className="card">
            <h3>Report PDF</h3>
            <label><input type="checkbox" checked={names} onChange={e => setNames(e.target.checked)} /> Includi dati anagrafici (nome e cognome)</label>
            <label><input type="checkbox" checked={onlyClosed} onChange={e => setOnlyClosed(e.target.checked)} /> Solo interventi conclusi</label>
            <div className="toolbar">
              <button onClick={() => window.open(String(make().output('bloburl')), '_blank')}>Apri / Stampa</button>
              <button className="ghost" onClick={() => make().save(`report_${ev.name.replace(/[^\w-]+/g, '_')}.pdf`)}>Scarica PDF</button>
            </div>
          </div>
          <p className="muted">{items.length} interventi in questo evento</p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>N°</th><th>Ora</th><th>Tipo</th><th>Spazio</th><th>Triage</th><th>Equipaggio</th><th>Stato</th></tr></thead>
              <tbody>
                {items.slice().sort((a, b) => (a.number ?? 0) - (b.number ?? 0)).map(i => (
                  <tr key={i.id}>
                    <td>{i.number ?? '…'}</td>
                    <td>{new Date(i.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{rd.types.find(t => t.id === i.event_type_id)?.name}</td>
                    <td>{rd.zoneLabel(i.zone_id)}</td>
                    <td style={{ background: i.triage ? TRIAGE_COLORS[i.triage] : undefined }}>{i.triage ?? '-'}</td>
                    <td>{rd.crews.find(c => c.id === i.crew_id)?.name ?? '-'}</td>
                    <td>{STATUS_LABEL[i.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {canEvent && <CreateEventDialog open={showCreate} onClose={() => setShowCreate(false)} />}
    </div>
  )
}
