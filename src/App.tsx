import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useLiveQuery } from 'dexie-react-hooks'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { supabase } from './lib/supabase'
import { db } from './lib/db'
import { forgetLocalKey } from './lib/vault'
import { setOnSynced, startSync } from './lib/sync'
import { useOnline } from './lib/hooks'
import type { Role } from './lib/types'
import { ROLE_LABEL } from './lib/types'
import Login from './pages/Login'
import CO from './pages/CO'
import Operatore from './pages/Operatore'
import Nuovo from './pages/Nuovo'
import Equipaggi from './pages/Equipaggi'
import Archivio from './pages/Archivio'
import Impostazioni from './pages/Impostazioni'
import Infermeria from './pages/Infermeria'
import Schieramento from './pages/Schieramento'
import { EventSelectionProvider, useEventSelection } from './lib/eventSelection'

const PAGES: Record<string, { label: string; el: ReactElement }> = {
  '/co': { label: 'Centrale', el: <CO /> },
  '/operatore': { label: 'I miei interventi', el: <Operatore /> },
  '/nuovo': { label: '+ Nuovo', el: <Nuovo /> },
  '/equipaggi': { label: 'Equipaggi', el: <Equipaggi /> },
  '/schieramento': { label: 'Schieramento', el: <Schieramento /> },
  '/infermeria': { label: 'Infermeria', el: <Infermeria /> },
  '/archivio': { label: 'Archivio', el: <Archivio /> },
  '/impostazioni': { label: 'Impostazioni', el: <Impostazioni /> },
}
const FULL = ['/co', '/nuovo', '/equipaggi', '/infermeria', '/archivio', '/impostazioni']
const NAV: Record<Role, string[]> = {
  admin: [...FULL.slice(0, 4), '/schieramento', ...FULL.slice(4)], co: ['/co', '/nuovo', '/equipaggi', '/schieramento', '/infermeria', '/archivio'], medico: ['/co', '/nuovo', '/schieramento', '/infermeria', '/archivio'], operatore: ['/operatore', '/nuovo', '/schieramento'],
}

function Live() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const online = useOnline()
  const userId = session?.user.id
  const pending = useLiveQuery(
    () => userId ? db.outbox.where('userId').equals(userId).count() : Promise.resolve(0),
    [userId],
    0,
  )
  const otherPending = useLiveQuery(async () => {
    const total = await db.outbox.count()
    return Math.max(0, total - pending)
  }, [userId, pending], 0)
  const [err, setErr] = useState('')

  useEffect(() => {
    setOnSynced(() => { void qc.invalidateQueries() })
    const on = () => { void qc.invalidateQueries() }
    window.addEventListener('online', on)
    const stop = startSync()
    return () => { window.removeEventListener('online', on); stop() }
  }, [qc])

  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const ch = supabase.channel('live')
      .on('postgres_changes', { event: '*', schema: 'public' }, () => {
        clearTimeout(t)
        t = setTimeout(() => { void qc.invalidateQueries() }, 300)
      })
      .subscribe()
    return () => { clearTimeout(t); void supabase.removeChannel(ch) }
  }, [qc])

  useEffect(() => {
    const h = (e: Event) => setErr(String((e as CustomEvent).detail))
    window.addEventListener('sync-error', h)
    return () => window.removeEventListener('sync-error', h)
  }, [])

  return (
    <>
      <span className={'pill ' + (online ? 'on' : 'off')}>
        {online ? 'Online' : 'Offline'}{pending ? ` · ${pending} da inviare` : ''}
        {otherPending ? ` · ${otherPending} per altri account` : ''}
      </span>
      {err && <div className="toast" onClick={() => setErr('')}>Errore di sincronizzazione: {err} (tocca per chiudere)</div>}
    </>
  )
}

function ActiveEventSelect() {
  const { events, selectedId, selectEvent, loading } = useEventSelection()
  if (loading || !events.length) return null
  return (
    <label className="event-switcher">
      <span>Evento</span>
      <select value={selectedId} onChange={e => selectEvent(e.target.value)}>
        <option value="">Scegli quale seguire…</option>
        {events.map(e => <option key={e.id} value={e.id}>{e.status === 'preparazione' ? 'Programmazione · ' : ''}{e.name}{e.venue ? ` · ${e.venue}` : ''}</option>)}
      </select>
    </label>
  )
}

function Shell() {
  const { session, profile, loading, recovery, vaultUnlocked, signOut } = useAuth()
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [resetMessage, setResetMessage] = useState('')
  const [resetDone, setResetDone] = useState(false)
  if (recovery && session) return <main>{resetDone ? <section className="form"><p className="eyebrow">SOCCORSO STADIO</p><h2>Password aggiornata</h2><p className="muted">Ora puoi accedere usando la nuova password.</p><button onClick={() => void signOut()}>Vai al login</button></section> : <form className="form" onSubmit={async e => {
    e.preventDefault()
    if (newPassword.length < 8) return setResetMessage('La password deve contenere almeno 8 caratteri.')
    if (newPassword !== confirmPassword) return setResetMessage('Le password non coincidono.')
    setResetBusy(true); setResetMessage('')
    const queued = await db.outbox.count()
    if (queued) {
      setResetBusy(false)
      setResetMessage('Prima di reimpostare la password, sincronizza tutte le modifiche offline: sono ancora cifrate con la password attuale.')
      return
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setResetBusy(false)
    if (error) setResetMessage(error.message)
    else {
      await db.cache.clear()
      await forgetLocalKey(session.user.id)
      setResetDone(true)
    }
  }}>
    <p className="eyebrow">SOCCORSO STADIO</p><h2>Imposta una nuova password</h2>
    <input type="password" autoComplete="new-password" placeholder="Nuova password (min. 8 caratteri)" value={newPassword} onChange={e => setNewPassword(e.target.value)} />
    <input type="password" autoComplete="new-password" placeholder="Conferma la nuova password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
    {resetMessage && <p className="muted">{resetMessage}</p>}
    <button disabled={resetBusy}>{resetBusy ? 'Aggiornamento…' : 'Salva nuova password'}</button>
  </form>}</main>
  if (loading) return <p style={{ padding: 16 }}>Caricamento…</p>
  if (!session) return <Login />
  if (!vaultUnlocked) return <Login />
  if (!profile || !profile.active) {
    return (
      <div style={{ padding: 16 }}>
        <p>Utente non abilitato. Contatta l'amministratore.</p>
        <button onClick={signOut}>Esci</button>
      </div>
    )
  }
  const paths = NAV[profile.role]
  return (
    <EventSelectionProvider role={profile.role} crewId={profile.crew_id} userId={profile.id}>
    <>
      <header className="top">
        <strong>🚑 Soccorso Stadio</strong>
        <nav className="nav">
          {paths.map(p => <NavLink key={p} to={p} className={({ isActive }) => (isActive ? 'active' : '')}>{PAGES[p].label}</NavLink>)}
        </nav>
        <ActiveEventSelect />
        <span className="who">{profile.full_name} · {ROLE_LABEL[profile.role]}</span>
        <Live />
        <button className="ghost" onClick={signOut}>Esci</button>
      </header>
      <main>
        <Routes>
          {paths.map(p => <Route key={p} path={p} element={PAGES[p].el} />)}
          <Route path="*" element={<Navigate to={paths[0]} replace />} />
        </Routes>
      </main>
    </>
    </EventSelectionProvider>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  )
}
