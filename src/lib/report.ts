import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import type { RefData } from './data'
import type { Ev, Intervention } from './types'
import { STATUS_LABEL } from './types'

type D = jsPDF & { lastAutoTable?: { finalY: number } }
const RGB: Record<string, [number, number, number]> = {
  bianco: [229, 231, 235], verde: [134, 239, 172], giallo: [253, 224, 71], rosso: [248, 113, 113],
}

export function buildReport(o: { event: Ev; items: Intervention[]; rd: RefData; names: boolean; onlyClosed: boolean }) {
  const items = (o.onlyClosed ? o.items.filter(i => i.status === 'concluso') : o.items)
    .slice().sort((a, b) => (a.number ?? 99999) - (b.number ?? 99999))
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' }) as D
  const fmt = (s?: string | null) => (s ? new Date(s).toLocaleString('it-IT') : '-')

  doc.setFontSize(16)
  doc.text('Report interventi di primo soccorso', 14, 14)
  doc.setFontSize(10)
  doc.text(`Evento: ${o.event.name}${o.event.venue ? ' · ' + o.event.venue : ''}`, 14, 21)
  doc.text(`Periodo: ${fmt(o.event.starts_at ?? o.event.created_at)} → ${fmt(o.event.ends_at)}`, 14, 26)
  doc.text(`Generato il ${new Date().toLocaleString('it-IT')} · Interventi: ${items.length}`, 14, 31)

  const count = (fn: (i: Intervention) => string) => {
    const m = new Map<string, number>()
    items.forEach(i => { const k = fn(i); m.set(k, (m.get(k) ?? 0) + 1) })
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, String(v)])
  }
  const blocks: [string, string[][], number][] = [
    ['Codice triage', count(i => i.triage ?? 'non assegnato'), 14],
    ['Tipo evento', count(i => o.rd.types.find(t => t.id === i.event_type_id)?.name ?? 'n/d'), 100],
    ['Spazio', count(i => o.rd.zoneLabel(i.zone_id)), 190],
  ]
  let maxY = 36
  for (const [title, rows, left] of blocks) {
    autoTable(doc, {
      startY: 36, margin: { left }, tableWidth: 80, theme: 'grid',
      head: [[title, 'N°']], body: rows, styles: { fontSize: 8 }, headStyles: { fillColor: [15, 23, 42] },
    })
    maxY = Math.max(maxY, doc.lastAutoTable?.finalY ?? 0)
  }

  autoTable(doc, {
    startY: maxY + 8, margin: { left: 14, right: 14 }, theme: 'grid',
    head: [['N°', 'Ora', 'Tipo', 'Spazio', 'Paziente', 'Età', 'Triage', 'Equipaggio', 'Stato', 'Esito / destinazione']],
    body: items.map(i => [
      i.number ?? '-',
      new Date(i.created_at).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }),
      o.rd.types.find(t => t.id === i.event_type_id)?.name ?? 'n/d',
      o.rd.zoneLabel(i.zone_id),
      o.names ? [i.first_name, i.last_name].filter(Boolean).join(' ') || 'n/d' : 'Anonimo',
      i.age ?? '-',
      i.triage ?? '-',
      o.rd.crews.find(c => c.id === i.crew_id)?.name ?? '-',
      STATUS_LABEL[i.status],
      [i.outcome, i.destination].filter(Boolean).join(' / ') || '-',
    ]),
    styles: { fontSize: 8 }, headStyles: { fillColor: [15, 23, 42] },
    didParseCell: d => {
      if (d.section === 'body' && d.column.index === 6) {
        const c = RGB[String(d.cell.raw)]
        if (c) d.cell.styles.fillColor = c
      }
    },
  })

  const n = doc.getNumberOfPages()
  for (let p = 1; p <= n; p++) {
    doc.setPage(p); doc.setFontSize(8)
    doc.text(`Pagina ${p} di ${n}`, 283, 205, { align: 'right' })
  }
  return doc
}
