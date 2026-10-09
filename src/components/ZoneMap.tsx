import type { Zone } from '../lib/types'

interface Props {
  image: string
  zones: Zone[]
  counts?: Record<string, number>
  selected?: string
  onPick?: (id: string) => void
  onPlace?: (x: number, y: number) => void
}

export default function ZoneMap({ image, zones, counts, selected, onPick, onPlace }: Props) {
  if (!image) return <p className="muted">Nessuna planimetria caricata (Impostazioni → Generale).</p>
  return (
    <div
      className="map"
      style={{ cursor: onPlace ? 'crosshair' : 'default' }}
      onClick={onPlace ? e => {
        const r = e.currentTarget.getBoundingClientRect()
        onPlace(Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, Math.round(((e.clientY - r.top) / r.height) * 1000) / 10)
      } : undefined}
    >
      <img src={image} alt="Planimetria" draggable={false} />
      {zones.filter(z => z.active && z.map_x != null && z.map_y != null).map(z => (
        <button
          key={z.id}
          title={z.name}
          className={'pin' + (selected === z.id ? ' sel' : '') + ((counts?.[z.id] ?? 0) > 0 ? ' hot' : '')}
          style={{ left: `${z.map_x}%`, top: `${z.map_y}%` }}
          onClick={e => { e.stopPropagation(); onPick?.(z.id) }}
        >
          {counts?.[z.id] ? counts[z.id] : ''}
        </button>
      ))}
    </div>
  )
}
