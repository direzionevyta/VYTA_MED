import { supabase } from './supabase'
import { db } from './db'
import type { OutboxItem } from './db'
import { decryptLocalValue, encryptLocalValue } from './vault'

let onSynced: () => void = () => {}
export const setOnSynced = (fn: () => void) => { onSynced = fn }

export async function enqueue(item: Omit<OutboxItem, 'seq' | 'at' | 'userId'>) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user.id) throw new Error('Sessione scaduta: accedi di nuovo prima di registrare modifiche offline.')
  await db.outbox.add({
    ...item,
    userId: session.user.id,
    payload: await encryptLocalValue(session.user.id, item.payload),
    payloadEncrypted: true,
    at: Date.now(),
  })
  void flush()
}

let running = false
export async function flush(force = false) {
  if (running || !navigator.onLine) return
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user.id
  if (!userId) return
  running = true
  let did = false
  try {
    const allItems = await db.outbox.where('userId').equals(userId).sortBy('seq')
    const now = Date.now()
    const items = allItems.filter(item => force || !item.nextRetryAt || item.nextRetryAt <= now)
    for (const it of items) {
      let payload: Record<string, unknown>
      const attemptCount = (it.attemptCount ?? 0) + 1
      await db.outbox.update(it.seq as number, { attemptCount, lastAttemptAt: now, syncError: undefined })
      try {
        payload = await decryptLocalValue<Record<string, unknown>>(userId, it.payload)
      } catch (err) {
        await db.outbox.update(it.seq as number, { syncError: 'decrypt', nextRetryAt: Date.now() + 3_600_000 })
        window.dispatchEvent(new CustomEvent('sync-error', {
          detail: 'Una modifica locale non può essere decifrata. È rimasta cifrata e in attesa; accedi con l’account che l’ha creata.',
        }))
        break
      }
      const res = it.kind === 'insert'
        ? await supabase.from(it.table).upsert({ id: it.id, ...payload }, { onConflict: 'id', ignoreDuplicates: true })
        : await supabase.from(it.table).update(payload).eq('id', it.id).select('id')
      const err = res.error
      if (err) {
        const permission = err.code === '42501' || err.code?.startsWith('28') === true
        const retryDelay = permission ? 3_600_000 : Math.min(30 * 60_000, 60_000 * 2 ** Math.min(attemptCount - 1, 5))
        await db.outbox.update(it.seq as number, {
          syncError: permission ? 'permission' : 'temporary', nextRetryAt: Date.now() + retryDelay,
        })
        window.dispatchEvent(new CustomEvent('sync-error', {
          detail: permission
            ? 'Il server ha rifiutato una modifica per mancanza di autorizzazione. La modifica cifrata è conservata; contatta l’amministratore.'
            : 'Invio non riuscito. La modifica cifrata è conservata su questo dispositivo; puoi riprovare.',
        }))
        break
      }
      if (it.kind === 'update' && (!Array.isArray(res.data) || res.data.length === 0)) {
        await db.outbox.update(it.seq as number, { syncError: 'not_applied', nextRetryAt: Date.now() + 3_600_000 })
        window.dispatchEvent(new CustomEvent('sync-error', {
          detail: 'Una modifica non è stata applicata. È conservata cifrata; verifica che l’account sia ancora abilitato.',
        }))
        break
      }
      await db.outbox.delete(it.seq as number)
      did = true
    }
  } finally {
    running = false
  }
  if (did) {
    onSynced()
    window.dispatchEvent(new CustomEvent('sync-complete', { detail: { at: Date.now() } }))
  }
}

export function startSync() {
  const on = () => { void flush() }
  window.addEventListener('online', on)
  const t = setInterval(on, 10000)
  on()
  return () => { window.removeEventListener('online', on); clearInterval(t) }
}
