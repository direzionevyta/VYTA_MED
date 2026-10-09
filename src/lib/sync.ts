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
export async function flush() {
  if (running || !navigator.onLine) return
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user.id
  if (!userId) return
  running = true
  let did = false
  try {
    const items = await db.outbox.where('userId').equals(userId).sortBy('seq')
    for (const it of items) {
      let payload: Record<string, unknown>
      try {
        payload = await decryptLocalValue<Record<string, unknown>>(userId, it.payload)
      } catch (err) {
        window.dispatchEvent(new CustomEvent('sync-error', {
          detail: err instanceof Error ? err.message : 'Impossibile decifrare una modifica offline.',
        }))
        break
      }
      const res = it.kind === 'insert'
        ? await supabase.from(it.table).upsert({ id: it.id, ...payload }, { onConflict: 'id', ignoreDuplicates: true })
        : await supabase.from(it.table).update(payload).eq('id', it.id)
      const err = res.error
      if (err) {
        window.dispatchEvent(new CustomEvent('sync-error', { detail: err.message }))
        break
      }
      await db.outbox.delete(it.seq as number)
      did = true
    }
  } finally {
    running = false
  }
  if (did) onSynced()
}

export function startSync() {
  const on = () => { void flush() }
  window.addEventListener('online', on)
  const t = setInterval(on, 10000)
  on()
  return () => { window.removeEventListener('online', on); clearInterval(t) }
}
