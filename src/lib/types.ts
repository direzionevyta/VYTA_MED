export type Role = 'admin' | 'co' | 'operatore' | 'medico'
export type Triage = 'bianco' | 'verde' | 'giallo' | 'rosso'
export type Status =
  | 'nuovo' | 'assegnato' | 'in_viaggio' | 'sul_posto'
  | 'in_trattamento' | 'in_trasporto' | 'concluso' | 'annullato'
export type CrewStatus = 'disponibile' | 'impegnato' | 'non_disponibile'

export interface Profile { id: string; email?: string | null; full_name: string; role: Role; crew_id: string | null; active: boolean; organization_id?: string | null; organization_slug?: string | null; is_platform_admin?: boolean }
export interface Organization { id: string; name: string; slug: string; active: boolean; is_demo: boolean; created_at: string }
export interface Structure { id: string; name: string; map_image: string; active: boolean; organization_id?: string | null; created_at?: string }
export interface Zone { id: string; structure_id?: string | null; name: string; parent_id: string | null; kind: string | null; map_x: number | null; map_y: number | null; sort: number; active: boolean }
export interface EventType { id: string; name: string; color: string; sort: number; active: boolean }
export interface CrewType { id: string; name: string; active: boolean }
export interface Crew { id: string; structure_id?: string | null; name: string; crew_type_id: string | null; members: number; status: CrewStatus; base_zone_id: string | null; active: boolean }
export interface Ev { id: string; name: string; venue: string | null; structure_id?: string | null; starts_at: string | null; ends_at: string | null; status: 'preparazione' | 'in_corso' | 'concluso'; intervention_counter: number; created_at: string }
export interface EventPost { id: string; event_id: string; zone_id: string; crew_id: string | null; post_number: number; created_at: string }
export interface Intervention {
  id: string; client_id?: string | null; event_id: string; number: number | null
  event_type_id: string | null; zone_id: string | null; location_note: string | null
  first_name: string | null; last_name: string | null; age: number | null; sex: string | null
  triage: Triage | null; status: Status; crew_id: string | null; crew_ids?: string[]
  notes: string | null; outcome: string | null; destination: string | null
  vital_signs?: Record<string, string | number | null> | null; treatments?: string | null; medications?: string | null
  created_by: string | null; created_at: string; updated_at: string; closed_at: string | null
  pending?: boolean
}

export const TRIAGE_LIST: Triage[] = ['bianco', 'verde', 'giallo', 'rosso']
export const TRIAGE_COLORS: Record<Triage, string> = { bianco: '#e5e7eb', verde: '#22c55e', giallo: '#facc15', rosso: '#ef4444' }
export const STATUS_ORDER: Status[] = ['nuovo', 'assegnato', 'in_viaggio', 'sul_posto', 'in_trattamento', 'in_trasporto', 'concluso', 'annullato']
export const ACTIVE: Status[] = ['nuovo', 'assegnato', 'in_viaggio', 'sul_posto', 'in_trattamento', 'in_trasporto']
export const STATUS_LABEL: Record<Status, string> = {
  nuovo: 'Nuovo', assegnato: 'Assegnato', in_viaggio: 'In viaggio', sul_posto: 'Sul posto',
  in_trattamento: 'In trattamento', in_trasporto: 'In trasporto', concluso: 'Concluso', annullato: 'Annullato',
}
export const CREW_LABEL: Record<CrewStatus, string> = { disponibile: 'Disponibile', impegnato: 'Impegnato', non_disponibile: 'Non disponibile' }
export const ROLE_LABEL: Record<Role, string> = { admin: 'Amministratore', co: 'Centrale Operativa', operatore: 'Operatore', medico: 'Medico/Infermiere' }
