import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { isNetworkFailure } from '../lib/network'
import { db } from '../lib/db'

export default function Login() {
  const { session, vaultUnlocked, unlockVault } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [forgotPassword, setForgotPassword] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  useEffect(() => {
    if (session?.user.email) setEmail(current => current || session.user.email || '')
  }, [session])

  const submit = async () => {
    setBusy(true); setError('')
    if (!navigator.onLine) {
      if (!session?.user.id || session.user.email?.toLocaleLowerCase() !== email.trim().toLocaleLowerCase()) {
        setError('Per accedere senza rete serve una sessione già attiva per questo account.')
      } else {
        try { await unlockVault(session.user.id, password) }
        catch (e) { setError(e instanceof Error ? e.message : 'Impossibile sbloccare i dati offline.') }
      }
      setBusy(false)
      return
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error && isNetworkFailure(error) && session?.user.id
      && session.user.email?.toLocaleLowerCase() === email.trim().toLocaleLowerCase()) {
      try { await unlockVault(session.user.id, password) }
      catch (e) { setError(e instanceof Error ? e.message : 'Impossibile sbloccare i dati offline.') }
    } else if (error || !data.user) setError('Credenziali non valide')
    else {
      try { await unlockVault(data.user.id, password) }
      catch (e) { setError(e instanceof Error ? e.message : 'Impossibile sbloccare i dati locali.') }
    }
    setBusy(false)
  }

  const requestPasswordReset = async () => {
    setBusy(true)
    setError('')
    if (!email.trim() || !email.includes('@')) {
      setError('Inserisci un indirizzo email valido.')
      setBusy(false)
      return
    }
    if (!navigator.onLine) {
      setError('Per richiedere il reset serve una connessione a Internet.')
      setBusy(false)
      return
    }
    const queued = await db.outbox.count()
    if (queued) {
      setError('Su questo dispositivo ci sono modifiche offline non sincronizzate. Per proteggere i dati, il reset è sospeso: riconnettiti e sincronizzale oppure contatta l’amministratore.')
      setBusy(false)
      return
    }
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    })
    if (resetError) {
      setError(isNetworkFailure(resetError)
        ? 'Connessione non disponibile. Riprova quando sei online.'
        : 'Non è stato possibile inviare la richiesta. Controlla l’indirizzo e riprova.')
    } else {
      setResetSent(true)
    }
    setBusy(false)
  }

  return (
    <div className="login">
      <h1>Soccorso Stadio</h1>
      {forgotPassword ? <>
        <h2>Recupera la password</h2>
        {resetSent ? <p className="muted">Se l’indirizzo è associato a un account, riceverai un’email con il link per scegliere una nuova password.</p> : <>
          <p className="muted">Inserisci l’email del tuo account. Ti invieremo un link per creare una nuova password.</p>
          <input type="email" autoComplete="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required />
          {error && <p className="err">{error}</p>}
          <button onClick={() => void requestPasswordReset()} disabled={busy || !email.trim()}>{busy ? 'Invio…' : 'Invia link di recupero'}</button>
        </>}
        <button className="ghost" onClick={() => { setForgotPassword(false); setResetSent(false); setError('') }}>Torna all’accesso</button>
      </> : <>
      {session && !vaultUnlocked && <p className="muted">Inserisci la password per sbloccare i dati locali cifrati.</p>}
      <input type="email" autoComplete="username" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
      <input type="password" autoComplete="current-password" placeholder="Password" value={password}
        onChange={e => setPassword(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()} />
      <button onClick={submit} disabled={busy}>{busy ? 'Verifica…' : session && !vaultUnlocked ? 'Sblocca' : 'Accedi'}</button>
      {error && <p className="err">{error}</p>}
      <button className="ghost" onClick={() => { setForgotPassword(true); setError('') }}>Password dimenticata?</button>
      </>}
    </div>
  )
}
