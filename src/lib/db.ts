import Dexie from 'dexie'
import type { Table } from 'dexie'

export interface OutboxItem {
  seq?: number
  kind: 'insert' | 'update'
  table: 'interventions' | 'crews'
  id: string
  userId?: string
  payload: Record<string, unknown>
  at: number
  lastAttemptAt?: number
  nextRetryAt?: number
  attemptCount?: number
  syncError?: 'decrypt' | 'permission' | 'not_applied' | 'temporary'
}
export interface EncryptedValue { version: 1; iv: string; ciphertext: string }
export interface StoredOutboxItem extends Omit<OutboxItem, 'payload'> {
  payload: Record<string, unknown> | EncryptedValue
  payloadEncrypted?: boolean
}
export interface CacheItem { key: string; value: unknown }
export interface VaultKey { id: string; salt: string; iv: string; ciphertext: string }

class AppDB extends Dexie {
  outbox!: Table<StoredOutboxItem, number>
  cache!: Table<CacheItem, string>
  vaultKeys!: Table<VaultKey, string>
  constructor() {
    super('stadio-soccorso')
    this.version(1).stores({ outbox: '++seq, id', cache: 'key' })
    this.version(2)
      .stores({ outbox: '++seq, id, userId', cache: 'key' })
      .upgrade(tx => tx.table('cache').clear())
    this.version(3).stores({ outbox: '++seq, id, userId', cache: 'key', vaultKeys: 'id' })
  }
}
export const db = new AppDB()
