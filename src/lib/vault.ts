import { db } from './db'
import type { EncryptedValue, OutboxItem } from './db'

const activeKeys = new Map<string, CryptoKey>()
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const KDF_ITERATIONS = 310_000

function isEncryptedValue(value: unknown): value is EncryptedValue {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<EncryptedValue>
  return candidate.version === 1 && typeof candidate.iv === 'string' && typeof candidate.ciphertext === 'string'
}

function toBase64(bytes: Uint8Array) {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function fromBase64(value: string) {
  const binary = atob(value)
  return Uint8Array.from(binary, char => char.charCodeAt(0))
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

async function deriveWrappingKey(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

async function getKey(userId: string, password: string): Promise<CryptoKey> {
  const active = activeKeys.get(userId)
  if (active) return active
  if (!globalThis.crypto?.subtle) throw new Error('La cifratura locale richiede un browser aggiornato e una connessione HTTPS.')
  const stored = await db.vaultKeys.get(userId)
  if (stored) {
    try {
      const wrappingKey = await deriveWrappingKey(password, fromBase64(stored.salt))
      const rawKey = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: toArrayBuffer(fromBase64(stored.iv)) },
        wrappingKey,
        toArrayBuffer(fromBase64(stored.ciphertext)),
      )
      const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt'])
      activeKeys.set(userId, key)
      return key
    } catch {
      throw new Error('Password non valida per sbloccare i dati offline di questo account.')
    }
  }
  if (!navigator.onLine) throw new Error('Per inizializzare la protezione offline serve una prima connessione a Internet.')
  const rawKey = crypto.getRandomValues(new Uint8Array(32))
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const wrappingKey = await deriveWrappingKey(password, salt)
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, }, wrappingKey, toArrayBuffer(rawKey))
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt', 'decrypt'])
  await db.vaultKeys.put({ id: userId, salt: toBase64(salt), iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) })
  activeKeys.set(userId, key)
  return key
}

export async function encryptLocalValue(userId: string, value: unknown): Promise<EncryptedValue> {
  const key = activeKeys.get(userId)
  if (!key) throw new Error('I dati locali sono bloccati. Sblocca nuovamente l’account.')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(value)))
  return { version: 1, iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) }
}

export async function decryptLocalValue<T>(userId: string, value: unknown): Promise<T> {
  if (!isEncryptedValue(value)) return value as T
  const key = activeKeys.get(userId)
  if (!key) throw new Error('I dati locali sono bloccati. Sblocca nuovamente l’account.')
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(fromBase64(value.iv)) },
    key,
    toArrayBuffer(fromBase64(value.ciphertext)),
  )
  return JSON.parse(decoder.decode(plaintext)) as T
}

export async function writeLocalCache(userId: string, cacheKey: string, value: unknown) {
  await db.cache.put({ key: cacheKey, value: await encryptLocalValue(userId, value) })
}

export async function readLocalCache<T>(userId: string, cacheKey: string): Promise<T | undefined> {
  const cached = await db.cache.get(cacheKey)
  if (!cached) return undefined
  if (isEncryptedValue(cached.value)) return decryptLocalValue<T>(userId, cached.value)
  // Upgrade a value written by an earlier version before returning it.
  await writeLocalCache(userId, cacheKey, cached.value)
  return cached.value as T
}

function cacheOwner(cacheKey: string) {
  if (cacheKey.startsWith('profile:')) return cacheKey.slice('profile:'.length)
  const separator = cacheKey.indexOf(':')
  return separator > 0 ? cacheKey.slice(0, separator) : null
}

export async function encryptExistingLocalData(userId: string) {
  const cachedItems = await db.cache.toArray()
  for (const item of cachedItems) {
    if (isEncryptedValue(item.value)) continue
    const owner = cacheOwner(item.key)
    if (owner !== userId) {
      await db.cache.delete(item.key)
      continue
    }
    await writeLocalCache(owner, item.key, item.value)
  }

  const queued = await db.outbox.toArray()
  for (const item of queued) {
    if (isEncryptedValue(item.payload)) continue
    if (item.userId !== userId) {
      throw new Error('Ci sono modifiche offline non cifrate di un altro account o senza proprietario. Accedi con l’account che le ha create e sincronizzale prima di continuare.')
    }
    await db.outbox.update(item.seq as number, {
      payload: await encryptLocalValue(userId, item.payload),
      payloadEncrypted: true,
    })
  }
}

export async function unlockLocalData(userId: string, password: string) {
  await getKey(userId, password)
  try {
    await encryptExistingLocalData(userId)
  } catch (error) {
    activeKeys.delete(userId)
    throw error
  }
}

export async function forgetLocalKey(userId: string) {
  activeKeys.delete(userId)
  await db.vaultKeys.delete(userId)
}

export function forgetActiveKeys() {
  activeKeys.clear()
}

export async function countUnencryptedOtherOutbox(userId: string) {
  const otherRows = await db.outbox.filter(item => item.userId !== userId).toArray()
  return otherRows.filter(item => !isEncryptedValue(item.payload)).length
}

export async function readEncryptedOutbox(userId: string): Promise<OutboxItem[]> {
  const stored = await db.outbox.where('userId').equals(userId).toArray()
  return Promise.all(stored.map(async item => ({
    ...item,
    userId,
    payload: await decryptLocalValue<Record<string, unknown>>(userId, item.payload),
  })))
}
