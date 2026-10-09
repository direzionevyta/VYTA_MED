import { supabase } from './supabase'
import { enqueue } from './sync'
import { uuid } from './hooks'
import { ACTIVE } from './types'
import type { CrewStatus, Intervention, Role, Structure } from './types'

export async function createIntervention(payload: Record<string, unknown>) {
  const id = uuid()
  await enqueue({
    kind: 'insert', table: 'interventions', id,
    payload: { ...payload, client_id: id, created_at: new Date().toISOString() },
  })
  if (payload.crew_id) {
    await enqueue({ kind: 'update', table: 'crews', id: payload.crew_id as string, payload: { status: 'impegnato' } })
  }
}

export async function setCrewStatus(id: string, status: CrewStatus) {
  await enqueue({ kind: 'update', table: 'crews', id, payload: { status } })
}

export async function patchIntervention(
  i: Intervention, patch: Partial<Intervention>, all: Intervention[], role: Role, ownCrew: string | null,
) {
  const p: Partial<Intervention> = { ...patch }
  if (p.crew_id && p.crew_id !== i.crew_id && i.status === 'nuovo' && !p.status) p.status = 'assegnato'
  await enqueue({ kind: 'update', table: 'interventions', id: i.id, payload: p as Record<string, unknown> })

  const crewOk = (id: string | null) => !!id && (role === 'admin' || role === 'co' || (role === 'operatore' && id === ownCrew))
  const status = p.status ?? i.status
  const closing = status === 'concluso' || status === 'annullato'
  const free = async (crewId: string | null) => {
    if (!crewId || !crewOk(crewId)) return
    const busy = all.some(x => x.id !== i.id && x.crew_id === crewId && ACTIVE.includes(x.status))
    if (!busy) await enqueue({ kind: 'update', table: 'crews', id: crewId, payload: { status: 'disponibile' } })
  }
  if (p.crew_id !== undefined && p.crew_id !== i.crew_id) {
    await free(i.crew_id)
    if (p.crew_id && !closing && crewOk(p.crew_id)) {
      await enqueue({ kind: 'update', table: 'crews', id: p.crew_id, payload: { status: 'impegnato' } })
    }
  } else if (closing && p.status && i.crew_id) {
    await free(i.crew_id)
  }
}

export async function createEvent(name: string, structure: Structure, status: 'preparazione' | 'in_corso'): Promise<string | null> {
  const { data, error } = await supabase.from('events').insert({
    name, venue: structure.name, structure_id: structure.id, status,
    starts_at: status === 'in_corso' ? new Date().toISOString() : null,
  }).select('id').single()
  if (error) { alert(error.message); return null }
  return data.id as string
}
