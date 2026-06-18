import { useEffect, useState } from 'react';
import type { GeneratedSchedule, Staff, NightTypeId, StaffStats } from '../types';
import { NIGHT_TYPES, NIGHT_TYPE_MAP, exportToCSV } from '../utils/scheduler';
import styles from './ScheduleResults.module.css';

interface Props {
  schedule: GeneratedSchedule;
  staff: Staff[];
  perNight: number;
  onRegenerate: () => void;
  onNewSchedule: () => void;
  onBack: () => void;
}

function rebuildStats(schedule: GeneratedSchedule, staff: Staff[]): StaffStats[] {
  const rawCount: Record<string, number> = {};
  const weightedTotal: Record<string, number> = {};
  const byType: Record<string, Record<NightTypeId, number>> = {};

  for (const s of staff) {
    rawCount[s.id] = 0;
    weightedTotal[s.id] = 0;
    byType[s.id] = {
      closedMeeting: 0,
      closed: 0,
      open: 0,
      openHeavy: 0,
    };
  }

  for (const assignment of schedule.assignments) {
    if (assignment.night.allStaffOnDuty) continue;

    const nightType = NIGHT_TYPE_MAP[assignment.night.typeId];

    for (const assignedStaff of assignment.assigned) {
      if (!rawCount[assignedStaff.id]) {
        rawCount[assignedStaff.id] = 0;
      }

      if (!weightedTotal[assignedStaff.id]) {
        weightedTotal[assignedStaff.id] = 0;
      }

      if (!byType[assignedStaff.id]) {
        byType[assignedStaff.id] = {
          closedMeeting: 0,
          closed: 0,
          open: 0,
          openHeavy: 0,
        };
      }

      rawCount[assignedStaff.id] += 1;
      weightedTotal[assignedStaff.id] += nightType.weight;
      byType[assignedStaff.id][assignment.night.typeId] += 1;
    }
  }

  return staff.map((s) => ({
    staffId: s.id,
    name: s.name,
    bunk: s.bunk,
    total: rawCount[s.id] ?? 0,
    weightedTotal: Math.round((weightedTotal[s.id] ?? 0) * 100) / 100,
    byType: byType[s.id] ?? {
      closedMeeting: 0,
      closed: 0,
      open: 0,
      openHeavy: 0,
    },
  }));
}

export default function ScheduleResults({ schedule, staff, perNight, onRegenerate, onNewSchedule, onBack }: Props) {
  const [overrideNight, setOverrideNight] = useState<string | null>(null);
  const [overrideSlot, setOverrideSlot] = useState<number | null>(null);
  const [localSchedule, setLocalSchedule] = useState(schedule);
  const [activeTab, setActiveTab] = useState<'schedule' | 'fairness'>('schedule');

  useEffect(() => {
    setLocalSchedule(schedule);
    setOverrideNight(null);
    setOverrideSlot(null);
  }, [schedule]);

  function handleCellClick(nightId: string, slotIdx: number) {
    setOverrideNight(nightId);
    setOverrideSlot(slotIdx);
  }

  function applyOverride(staffId: string) {
    if (overrideNight === null || overrideSlot === null) return;

    const newStaff = staff.find((s) => s.id === staffId);
    if (!newStaff) return;

    setLocalSchedule((prev) => {
      const updatedAssignments = prev.assignments.map((a) => {
        if (a.night.id !== overrideNight) return a;

        const newAssigned = [...a.assigned];
        newAssigned[overrideSlot] = newStaff;

        return { ...a, assigned: newAssigned };
      });

      const updatedSchedule: GeneratedSchedule = {
        ...prev,
        assignments: updatedAssignments,
      };

      return {
        ...updatedSchedule,
        stats: rebuildStats(updatedSchedule, staff),
      };
    });

    setOverrideNight(null);
    setOverrideSlot(null);
  }

  function downloadCSV() {
    const csv = exportToCSV(localSchedule, perNight);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = 'od_schedule.csv';
    a.click();

    URL.revokeObjectURL(url);
  }

  const maxWeighted = Math.max(...localSchedule.stats.map((s) => s.weightedTotal));
  const minWeighted = Math.min(...localSchedule.stats.map((s) => s.weightedTotal));
  const spread = maxWeighted - minWeighted;

  const scoredDayCount = localSchedule.assignments.filter(
    (a) => !a.night.allStaffOnDuty
  ).length;

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.headerLeft}>
          <h2>Generated Schedule</h2>
          <span className={styles.meta}>
            {localSchedule.assignments.length} days &middot; {scoredDayCount} scored &middot;{' '}
            {staff.length} staff &middot; {perNight}/night
          </span>
        </div>

        <div className={styles.headerActions}>
          <button className={styles.regenBtn} onClick={onRegenerate} type="button">
            Regenerate
          </button>
          <button className={styles.newScheduleBtn} onClick={onNewSchedule} type="button">
            New Schedule
          </button>
          <button className={styles.exportBtn} onClick={downloadCSV} type="button">
            Export CSV
          </button>
        </div>
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'schedule' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('schedule')}
          type="button"
        >
          Schedule
        </button>

        <button
          className={`${styles.tab} ${activeTab === 'fairness' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('fairness')}
          type="button"
        >
          Fairness
          {spread > 2 && <span className={styles.warningDot} title="Weighted spread &gt; 2" />}
        </button>
      </div>

      {activeTab === 'schedule' && (
        <div className={styles.scheduleSection}>
          <p className={styles.hint}>Click any name to swap it out.</p>

          <div className={styles.tableWrap}>
            <table className={styles.schedTable}>
              <thead>
                <tr>
                  <th className={styles.nightCol}>Night</th>
                  <th className={styles.typeCol}>Type</th>
                  {Array.from({ length: perNight }, (_, i) => (
                    <th key={i} className={styles.odCol}>
                      OD {i + 1}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {localSchedule.assignments.map(({ night, assigned }, dayIdx) => {
                  const dayLabel = `Day ${dayIdx + 1}${night.label ? ` — ${night.label}` : ''}`;

                  if (night.allStaffOnDuty) {
                    return (
                      <tr key={night.id} className={styles.allStaffNightRow}>
                        <td className={styles.nightLabel}>{dayLabel}</td>
                        <td>
                          <span className={`${styles.pill} ${styles['pill-allstaff']}`}>
                            All staff
                          </span>
                        </td>
                        <td colSpan={perNight} className={styles.allStaffCell}>
                          All staff on duty
                        </td>
                      </tr>
                    );
                  }

                  const nt = NIGHT_TYPE_MAP[night.typeId];

                  return (
                    <tr key={night.id}>
                      <td className={styles.nightLabel}>{dayLabel}</td>
                      <td>
                        <span className={`${styles.pill} ${styles[`pill-${nt.color}`]}`}>
                          {nt.shortLabel}
                        </span>
                      </td>

                      {assigned.map((s, slotIdx) => (
                        <td
                          key={slotIdx}
                          className={`${styles.staffCell} ${overrideNight === night.id && overrideSlot === slotIdx
                              ? styles.cellActive
                              : ''
                            }`}
                          onClick={() => handleCellClick(night.id, slotIdx)}
                        >
                          <span className={styles.staffName}>{s.name}</span>
                          <span className={styles.staffBunk}>{s.bunk}</span>
                        </td>
                      ))}

                      {Array.from({ length: perNight - assigned.length }, (_, i) => (
                        <td key={`pad-${i}`} className={styles.staffCell} />
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'fairness' && (
        <div className={styles.fairnessSection}>
          <div className={styles.fairnessMeta}>
            <span className={styles.spreadLabel}>Weighted spread:</span>
            <span
              className={`${styles.spreadValue} ${spread > 2 ? styles.spreadWarn : styles.spreadOk
                }`}
            >
              {spread.toFixed(2)}
            </span>
            <span className={styles.spreadHint}>
              (
              {spread <= 0.5
                ? 'Excellent'
                : spread <= 1
                  ? 'Good'
                  : spread <= 2
                    ? 'Fair'
                    : 'Consider regenerating'}
              )
            </span>
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.fairTable}>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Bunk</th>
                  <th>Total</th>
                  <th>Weighted</th>
                  {NIGHT_TYPES.map((nt) => (
                    <th key={nt.id}>
                      <span className={`${styles.pill} ${styles[`pill-${nt.color}`]}`}>
                        {nt.shortLabel}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {[...localSchedule.stats]
                  .sort((a, b) => b.weightedTotal - a.weightedTotal)
                  .map((stat) => {
                    const pct = maxWeighted > 0 ? (stat.weightedTotal / maxWeighted) * 100 : 0;

                    return (
                      <tr key={stat.staffId}>
                        <td className={styles.statName}>{stat.name}</td>
                        <td className={styles.statBunk}>{stat.bunk}</td>
                        <td>
                          <span className={styles.mono}>{stat.total}</span>
                        </td>
                        <td>
                          <div className={styles.barCell}>
                            <div className={styles.bar} style={{ width: `${pct}%` }} />
                            <span className={styles.mono}>
                              {stat.weightedTotal.toFixed(2)}
                            </span>
                          </div>
                        </td>

                        {NIGHT_TYPES.map((nt) => (
                          <td key={nt.id} className={styles.typeCount}>
                            <span className={styles.mono}>
                              {stat.byType[nt.id as NightTypeId]}
                            </span>
                          </td>
                        ))}
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {overrideNight !== null && overrideSlot !== null && (
        <div
          className={styles.modalOverlay}
          onClick={() => {
            setOverrideNight(null);
            setOverrideSlot(null);
          }}
        >
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Swap staff member</h3>
              <button
                className={styles.modalClose}
                onClick={() => {
                  setOverrideNight(null);
                  setOverrideSlot(null);
                }}
                type="button"
              >
                &times;
              </button>
            </div>

            <div className={styles.modalBody}>
              {staff.map((s) => (
                <button
                  key={s.id}
                  className={styles.swapOption}
                  onClick={() => applyOverride(s.id)}
                  type="button"
                >
                  <span className={styles.swapName}>{s.name}</span>
                  <span className={styles.swapBunk}>{s.bunk}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className={styles.footer}>
        <button className={styles.backBtn} onClick={onBack} type="button">
          &larr; Back to setup
        </button>
      </div>
    </div>
  );
}