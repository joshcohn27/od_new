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
  label: string; // optional note — display name is computed as "Day N" from position
  typeId: NightTypeId;
  allStaffOnDuty?: boolean; // if true: all staff assigned, excluded from fairness accounting
  unavailableStaffIds?: string[]; // staff who cannot be assigned on this night
}

export interface FrozenAssignment {
  nightId: string;
  slotIndex: number; // 0-based
  staff: Staff;
}

export interface LockedOutAssignment {
  nightId: string;
  slotIndex: number; // 0-based
  staffId: string; // staff excluded from this specific slot
}

export interface ScheduleConfig {
  staff: Staff[];
  nights: Night[];
  perNight: number;
  bunkRestriction: boolean; // true = can only OD own bunk
  frozenAssignments?: FrozenAssignment[];
  lockedOutAssignments?: LockedOutAssignment[];
}

export interface AssignedNight {
  night: Night;
  assigned: Staff[];
  unfillable?: boolean; // true if this night could not be fully staffed under hard constraints
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
