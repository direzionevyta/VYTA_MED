const APP_ROUTES = new Set([
  'co', 'operatore', 'nuovo', 'equipaggi', 'schieramento',
  'infermeria', 'archivio', 'impostazioni',
])

export function tenantBasePath(): string {
  const first = window.location.pathname.split('/').filter(Boolean)[0]
  return first && !APP_ROUTES.has(first) ? `/${first}` : ''
}

export function tenantUrl(path = '/'): string {
  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${window.location.origin}${tenantBasePath()}${suffix}`
}

export function organizationUrl(slug: string): string {
  return `${window.location.origin}/${encodeURIComponent(slug)}`
}
