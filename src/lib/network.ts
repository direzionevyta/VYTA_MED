export function isNetworkFailure(error: unknown) {
  if (!navigator.onLine || error instanceof TypeError) return true
  if (!error || typeof error !== 'object') return false
  const detail = error as { status?: unknown; message?: unknown }
  if (detail.status === 0) return true
  return typeof detail.message === 'string'
    && /failed to fetch|fetch failed|network request failed|networkerror|load failed/i.test(detail.message)
}
