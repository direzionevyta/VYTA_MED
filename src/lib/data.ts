import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { supabase } from './supabase'
import { useAuth } from '../auth/AuthContext'
import { readEncryptedOutbox, readLocalCache, writeLocalCache } from './vault'
import { isNetworkFailure } from './network'
import type { OutboxItem } from './db'
import type { Crew, CrewType, EventType, Ev, Intervention, Structure, Zone, Role } from './types'
import { tenantBasePath } from './tenant'

export function useActiveOrganizationId() {
  const { profile } = useAuth()
  const slug = tenantBasePath().replace(/^\//, '')
  return useCached<string | null>(['active-organization', slug || profile?.organization_id || 'none'], async () => {
    if (!slug) return profile?.organization_id ?? null
    const { data, error } = await supabase.from('organizations').select('id').eq('slug', slug).eq('active', true).maybeSingle()
    if (error) throw error
    return data?.id ?? null
  }, !!profile)
}

export function useCached<T>(key: string[], fetcher: () => Promise<T>, enabled = true) {
  const { session } = useAuth()
  const userId = session?.user.id ?? 'anon'
  const cacheKey = `${userId}:${key.join(':')}`
  return useQuery<T>({
    queryKey: [...key, 'user', userId],
    enabled,
    queryFn: async () => {
      try {
        const v = await fetcher()
        await writeLocalCache(userId, cacheKey, v)
        return v
      } catch (e) {
        if (!isNetworkFailure(e)) throw e
        const cached = await readLocalCache<T>(userId, cacheKey)
        if (cached !== undefined) return cached
        throw e
      }
    },
  })
}

export async function all<T>(table: string, order: string, asc = true): Promise<T[]> {
  const { data, error } = await supabase.from(table).select('*').order(order, { ascending: asc })
  if (error) throw error
  return (data ?? []) as T[]
}

export interface RefData {
  zones: Zone[]; types: EventType[]; crewTypes: CrewType[]; crews: Crew[]; structures: Structure[]
  settings: Record<string, unknown>; mapImage: string
  zoneLabel: (id: string | null) => string
  loading: boolean
}
const NONE: never[] = []
const NOSET: Record<string, unknown> = {}

export function useRefData(structureId?: string | null): RefData {
  const organizationId = useActiveOrganizationId()
  const z = useCached<Zone[]>(['zones', organizationId.data ?? 'none', structureId ?? 'all'], async () => {
    if (!organizationId.data) return []
    let q = supabase.from('zones').select('*').order('sort')
    if (structureId) q = q.eq('structure_id', structureId)
    else {
      const { data: structures, error: structureError } = await supabase.from('structures').select('id').eq('organization_id', organizationId.data)
      if (structureError) throw structureError
      const ids = (structures ?? []).map(s => s.id)
      if (!ids.length) return []
      q = q.in('structure_id', ids)
    }
    const { data, error } = await q
    if (error) throw error
    return (data ?? []) as Zone[]
  })
  const structuresQ = useCached<Structure[]>(['structures', organizationId.data ?? 'none'], async () => {
    if (!organizationId.data) return []
    const { data, error } = await supabase.from('structures').select('*').eq('organization_id', organizationId.data).order('name')
    if (error) throw error
    return (data ?? []) as Structure[]
  }, !!organizationId.data)
  const t = useCached<EventType[]>(['event_types', organizationId.data ?? 'none'], async () => {
    if (!organizationId.data) return []
    const { data, error } = await supabase.from('event_types').select('*').eq('organization_id', organizationId.data).order('sort')
    if (error) throw error
    return (data ?? []) as EventType[]
  }, !!organizationId.data)
  const ct = useCached<CrewType[]>(['crew_types', organizationId.data ?? 'none'], async () => {
    if (!organizationId.data) return []
    const { data, error } = await supabase.from('crew_types').select('*').eq('organization_id', organizationId.data).order('name')
    if (error) throw error
    return (data ?? []) as CrewType[]
  }, !!organizationId.data)
  const c = useCached<Crew[]>(['crews', organizationId.data ?? 'none', structureId ?? 'all'], async () => {
    if (!organizationId.data) return []
    let q = supabase.from('crews').select('*').order('name')
    if (structureId) q = q.eq('structure_id', structureId)
    else {
      const ids = (structuresQ.data ?? []).map(s => s.id)
      if (!ids.length) return []
      q = q.in('structure_id', ids)
    }
    const { data, error } = await q
    if (error) throw error
    return (data ?? []) as Crew[]
  })
  const s = useCached<Record<string, unknown>>(['settings', organizationId.data ?? 'none'], async () => {
    if (!organizationId.data) return {}
    const { data: rows, error } = await supabase.from('settings').select('key,value').eq('organization_id', organizationId.data).order('key')
    if (error) throw error
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  })
  const zones = z.data ?? NONE
  const settings = s.data ?? NOSET
  const zoneLabel = (id: string | null) => {
    if (!id) return 'n/d'
    const parts: string[] = []
    let cur = zones.find(x => x.id === id)
    let guard = 0
    while (cur && guard++ < 6) {
      parts.unshift(cur.name)
      const p: string | null = cur.parent_id
      cur = p ? zones.find(x => x.id === p) : undefined
    }
    return parts.join(' › ') || 'n/d'
  }
  return {
    zones, types: t.data ?? NONE, crewTypes: ct.data ?? NONE, crews: c.data ?? NONE, structures: structuresQ.data ?? NONE, settings,
    mapImage: structureId ? structuresQ.data?.find(s => s.id === structureId)?.map_image ?? '' : (typeof settings['map_image'] === 'string' ? (settings['map_image'] as string) : ''),
    zoneLabel,
    loading: z.isLoading || t.isLoading || c.isLoading,
  }
}

export function useActiveEvent(role: Role | undefined, crewId: string | null, userId: string) {
  const organizationId = useActiveOrganizationId()
  return useCached<Ev[]>(['events', 'active', organizationId.data ?? 'none', role ?? 'anon', crewId ?? 'none', userId], async () => {
    if (role !== 'admin' && !userId) return []
    if (!organizationId.data) return []
    const { data: structures, error: structureError } = await supabase.from('structures').select('id').eq('organization_id', organizationId.data)
    if (structureError) throw structureError
    const structureIds = (structures ?? []).map(s => s.id)
    if (!structureIds.length) return []
    let q = supabase.from('events').select('*').in('status', ['preparazione', 'in_corso']).order('created_at', { ascending: false })
      .in('structure_id', structureIds)
    const { data, error } = await q
    if (error) throw error
    return (data ?? []) as Ev[]
  })
}

function overlay(base: Intervention[], outbox: OutboxItem[], eventId: string): Intervention[] {
  const map = new Map<string, Intervention>(base.map(i => [i.id, { ...i }]))
  for (const it of outbox) {
    if (it.table !== 'interventions') continue
    if (it.kind === 'insert') {
      if (map.has(it.id) || it.payload.event_id !== eventId) continue
      const iso = new Date(it.at).toISOString()
      const blank: Intervention = {
        id: it.id, client_id: it.id, event_id: eventId, number: null, event_type_id: null, zone_id: null,
        location_note: null, first_name: null, last_name: null, age: null, sex: null, triage: null,
        status: 'nuovo', crew_id: null, crew_ids: [], notes: null, outcome: null, destination: null, created_by: null,
        created_at: iso, updated_at: iso, closed_at: null, pending: true,
      }
      map.set(it.id, { ...blank, ...(it.payload as Partial<Intervention>) })
    } else {
      const cur = map.get(it.id)
      if (cur) map.set(it.id, { ...cur, ...(it.payload as Partial<Intervention>), pending: true })
    }
  }
  return [...map.values()].sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export function useInterventions(eventId?: string | null, role?: Role, crewId?: string | null) {
  const { session } = useAuth()
  const userId = session?.user.id
  const q = useCached<Intervention[]>(['interventions', eventId ?? 'none', role ?? 'anon', crewId ?? 'none'], async () => {
    let query = supabase.from('interventions').select('*').eq('event_id', eventId as string).order('created_at', { ascending: false })
    if (role !== 'admin' && role !== 'co') {
      if (!crewId) return []
      query = query.or(`crew_id.eq.${crewId},crew_ids.cs.{${crewId}}`)
    }
    const { data, error } = await query
    if (error) throw error
    return (data ?? []) as Intervention[]
  }, !!eventId)
  const outbox = useLiveQuery(
    () => userId ? readEncryptedOutbox(userId) : Promise.resolve([]),
    [userId],
    [] as OutboxItem[],
  )
  const items = useMemo(() => {
    const merged = overlay(q.data ?? [], outbox, eventId ?? '')
    return role === 'admin' || role === 'co'
      ? merged
      : merged.filter(i => !!crewId && (i.crew_id === crewId || i.crew_ids?.includes(crewId)))
  }, [q.data, outbox, eventId, role, crewId])
  return { items, isLoading: q.isLoading }
}
