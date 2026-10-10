import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { flush } from '../lib/sync'
import { countUnencryptedOtherOutbox, forgetActiveKeys, forgetLocalKey, readLocalCache, unlockLocalData, writeLocalCache } from '../lib/vault'
import { isNetworkFailure } from '../lib/network'
import type { Profile } from '../lib/types'

interface AuthState {
  session: Session | null
  profile: Profile | null
  loading: boolean
  recovery: boolean
  vaultUnlocked: boolean
  unlockVault: (userId: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}
const Ctx = createContext<AuthState>({
  session: null, profile: null, loading: true, recovery: false, vaultUnlocked: false,
  unlockVault: async () => {}, signOut: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const activeUserId = useRef<string | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const [recovery, setRecovery] = useState(false)
  const [vaultUnlocked, setVaultUnlocked] = useState(false)

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      const nextUserId = s?.user.id ?? null
      const userChanged = nextUserId !== activeUserId.current
      if (activeUserId.current !== null && nextUserId !== activeUserId.current) {
        activeUserId.current = nextUserId
        queryClient.clear()
        void db.cache.clear()
        forgetActiveKeys()
        setVaultUnlocked(false)
      } else if (activeUserId.current === null) {
        activeUserId.current = nextUserId
      }
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      setSession(s)
      if (!s) { setProfile(null); setRecovery(false); setVaultUnlocked(false); setLoading(false) }
      else if (userChanged || event === 'INITIAL_SESSION') { setProfile(null); setLoading(false) }
    })
    return () => sub.subscription.unsubscribe()
  }, [queryClient])

  useEffect(() => {
    if (!session || !vaultUnlocked) return
    let current = true
    const uid = session.user.id
    supabase.from('profiles').select('*').eq('id', uid).maybeSingle().then(async ({ data, error }) => {
      if (error) {
        if (!isNetworkFailure(error)) {
          if (current) { setProfile(null); setLoading(false) }
          return
        }
        const cp = await readLocalCache<Profile>(uid, `profile:${uid}`)
        if (current) setProfile(cp && cp.id === uid ? cp : null)
      } else {
        if (!current) return
        const loaded = (data as Profile | null) ?? null
        if (loaded?.organization_id) {
          const { data: org } = await supabase.from('organizations').select('slug,is_demo').eq('id', loaded.organization_id).maybeSingle()
          if (org?.slug) loaded.organization_slug = org.slug as string
          loaded.organization_is_demo = org?.is_demo === true
        }
        setProfile(loaded)
        if (loaded) await writeLocalCache(uid, `profile:${uid}`, loaded)
      }
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [session, vaultUnlocked])

  const unlockVault = async (userId: string, password: string) => {
    const { data: { session: currentSession } } = await supabase.auth.getSession()
    if (!currentSession?.user.id || currentSession.user.id !== userId) throw new Error('Accedi prima di sbloccare i dati locali.')
    setLoading(true)
    try {
      await unlockLocalData(userId, password)
      setVaultUnlocked(true)
    } catch (error) {
      setLoading(false)
      throw error
    }
  }

  const signOut = async () => {
    const userId = session?.user.id
    if (userId) {
      await flush()
      const [ownedPending, unencryptedOtherPending] = await Promise.all([
        db.outbox.where('userId').equals(userId).count(),
        countUnencryptedOtherOutbox(userId),
      ])
      if (unencryptedOtherPending) {
        alert('Ci sono modifiche offline non cifrate di un altro account o senza proprietario. Accedi con l’account che le ha create e sincronizzale prima di uscire.')
        return
      }
      if (ownedPending) {
        alert('Ci sono modifiche non sincronizzate. Riconnettiti e attendi la sincronizzazione prima di uscire.')
        return
      }
    }
    await db.cache.clear()
    if (userId) await forgetLocalKey(userId)
    forgetActiveKeys()
    queryClient.clear()
    await supabase.auth.signOut()
  }
  return <Ctx.Provider value={{ session, profile, loading, recovery, vaultUnlocked, unlockVault, signOut }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
