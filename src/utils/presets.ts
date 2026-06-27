import type { Night } from '../types';
import { addDaysISO } from './dates';

export const SESSION_1_2026_START = '2026-06-28';

const SESSION_1_2026_NIGHTS: Omit<Night, 'id' | 'date'>[] = [
  { allStaffOnDuty: true,  typeId: 'closed',        label: 'arrival' },
  { allStaffOnDuty: false, typeId: 'open',           label: '' },
  { allStaffOnDuty: false, typeId: 'closedMeeting',  label: 'staff meeting' },
  { allStaffOnDuty: false, typeId: 'open',           label: '' },
  { allStaffOnDuty: false, typeId: 'open',           label: '' },
  { allStaffOnDuty: false, typeId: 'closed',         label: '' },
  { allStaffOnDuty: false, typeId: 'open',           label: '12:30am' },
  { allStaffOnDuty: false, typeId: 'open',           label: '' },
  { allStaffOnDuty: false, typeId: 'open',           label: '' },
  { allStaffOnDuty: false, typeId: 'closedMeeting',  label: 'staff meeting' },
  { allStaffOnDuty: false, typeId: 'open',           label: '' },
  { allStaffOnDuty: false, typeId: 'open',           label: '' },
  { allStaffOnDuty: false, typeId: 'closed',         label: '' },
  { allStaffOnDuty: false, typeId: 'closedMeeting',  label: 'staff meeting' },
  { allStaffOnDuty: false, typeId: 'openHeavy',      label: 'visitors day' },
  { allStaffOnDuty: false, typeId: 'closedMeeting',  label: 'staff meeting' },
  { allStaffOnDuty: false, typeId: 'closed',         label: '' },
  { allStaffOnDuty: false, typeId: 'closed',         label: '' },
  { allStaffOnDuty: false, typeId: 'openHeavy',      label: 'night after MP' },
  { allStaffOnDuty: false, typeId: 'closed',         label: '' },
  { allStaffOnDuty: false, typeId: 'open',           label: '12:30am' },
  { allStaffOnDuty: false, typeId: 'closed',         label: '' },
  { allStaffOnDuty: false, typeId: 'open',           label: '' },
  { allStaffOnDuty: false, typeId: 'open',           label: '' },
  { allStaffOnDuty: false, typeId: 'closedMeeting',  label: 'staff meeting' },
  { allStaffOnDuty: false, typeId: 'closed',         label: '' },
  { allStaffOnDuty: true,  typeId: 'closed',         label: 'last day session 1' },
];

export const SESSION_1_2026: Omit<Night, 'id'>[] = SESSION_1_2026_NIGHTS.map((n, idx) => ({
  ...n,
  date: addDaysISO(SESSION_1_2026_START, idx),
}));
