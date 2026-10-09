import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useRefData } from '../lib/data'
import { createEvent } from '../lib/actions'
import { useEventSelection } from '../lib/eventSelection'

export default function CreateEventDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const selection = useEventSelection()
  const rd = useRefData()
  const [name, setName] = useState('')
  const [structureId, setStructureId] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<'preparazione' | 'in_corso'>('preparazione')
  if (!open) return null
  const structures = rd.structures.filter(s => s.active)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const structure = structures.find(s => s.id === structureId)
    if (!name.trim() || !structure) return
    setBusy(true)
    const eventId = await createEvent(name.trim(), structure, status)
    setBusy(false)
    if (!eventId) return
    await qc.invalidateQueries()
    selection.selectEvent(eventId)
    setName('')
    setStructureId('')
    onClose()
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <form className="modal-card" onSubmit={submit}>
      <div className="row"><div><p className="eyebrow">NUOVA APERTURA</p><h2>Nuovo evento</h2></div><button type="button" className="ghost close-button" aria-label="Chiudi" onClick={onClose}>×</button></div>
      <p className="muted">L’evento userà gli spazi e la planimetria della struttura selezionata. Puoi preparare prima lo schieramento e avviarlo il giorno dell’evento.</p>
      <label>Nome evento<input autoFocus required placeholder="Es. Partita del 12 ottobre" value={name} onChange={e => setName(e.target.value)} /></label>
      <label>Struttura<select required value={structureId} onChange={e => setStructureId(e.target.value)}>
        <option value="">Scegli una struttura salvata…</option>
        {structures.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select></label>
      <label>Avvio<select value={status} onChange={e => setStatus(e.target.value as 'preparazione' | 'in_corso')}>
        <option value="preparazione">Crea come programmazione</option>
        <option value="in_corso">Apri subito l’evento</option>
      </select></label>
      {!structures.length && <p className="err">Non ci sono strutture attive. Creane una in Impostazioni → Strutture.</p>}
      <div className="modal-actions"><button type="button" className="ghost" onClick={onClose}>Annulla</button><button type="submit" disabled={busy || !structures.length}>{busy ? 'Salvataggio…' : status === 'preparazione' ? 'Crea programmazione' : 'Apri evento'}</button></div>
    </form>
  </div>
}
