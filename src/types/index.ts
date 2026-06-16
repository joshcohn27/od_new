export type NightTypeId = 'closedMeeting' | 'closed' | 'open' | 'openHeavy';

export interface NightTypeConfig {
  id: NightTypeId;
  label: string;
  shortLabel: string;
  weight: number;
  color: string; // CSS class suffix
}

export interface Staff {
  id: string;
  name: string;
  bunk: string;
}

export interface Night {
  id: string;
  label: string; // e.g. "Night 1", "July 4", whatever user wants
  typeId: NightTypeId;
}

export interface ScheduleConfig {
  staff: Staff[];
  nights: Night[];
  perNight: number;
  bunkRestriction: boolean; // true = can only OD own bunk
}

export interface AssignedNight {
  night: Night;
  assigned: Staff[];
}

export interface StaffStats {
  staffId: string;
  name: string;
  bunk: string;
  total: number;
  weightedTotal: number;
  byType: Record<NightTypeId, number>;
}

export interface GeneratedSchedule {
  assignments: AssignedNight[];
  stats: StaffStats[];
  seed: number;
}

export type AppStep = 'setup-staff' | 'setup-nights' | 'generate' | 'results';
