import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useActiveEvent } from './data'
import type { Ev, Role } from './types'

interface EventSelection {
  events: Ev[]
  selectedEvent: Ev | null
  selectedId: string
  selectEvent: (id: string) => void
  loading: boolean
}

const Context = createContext<EventSelection | null>(null)

export function EventSelectionProvider({ role, crewId, userId, children }: {
  role: Role; crewId: string | null; userId: string; children: ReactNode
}) {
  const query = useActiveEvent(role, crewId, userId)
  const events = query.data ?? []
  const key = `selected-event:${userId}`
  const [selectedId, setSelectedId] = useState(() => localStorage.getItem(key) ?? '')

  useEffect(() => {
    if (query.isLoading) return
    if (selectedId && !events.some(event => event.id === selectedId)) {
      setSelectedId('')
      localStorage.removeItem(key)
      return
    }
    if (!selectedId && events.length === 1) {
      setSelectedId(events[0].id)
      localStorage.setItem(key, events[0].id)
    }
  }, [events, key, query.isLoading, selectedId])

  const selectEvent = (id: string) => {
    setSelectedId(id)
    if (id) localStorage.setItem(key, id)
    else localStorage.removeItem(key)
  }
  const value = useMemo(() => ({
    events,
    selectedEvent: events.find(event => event.id === selectedId) ?? null,
    selectedId,
    selectEvent,
    loading: query.isLoading,
  }), [events, selectedId, query.isLoading])

  return <Context.Provider value={value}>{children}</Context.Provider>
}

export function useEventSelection() {
  const value = useContext(Context)
  if (!value) throw new Error('EventSelectionProvider mancante')
  return value
}
