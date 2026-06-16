import { useState } from 'react';
import type { GeneratedSchedule, Staff, NightTypeId } from '../types';
import { NIGHT_TYPES, NIGHT_TYPE_MAP, exportToCSV } from '../utils/scheduler';
import styles from './ScheduleResults.module.css';

interface Props {
  schedule: GeneratedSchedule;
  staff: Staff[];
  perNight: number;
  onRegenerate: () => void;
  onBack: () => void;
}

export default function ScheduleResults({ schedule, staff, perNight, onRegenerate, onBack }: Props) {
  const [overrideNight, setOverrideNight] = useState<string | null>(null);
  const [overrideSlot, setOverrideSlot] = useState<number | null>(null);
  const [localSchedule, setLocalSchedule] = useState(schedule);
  const [activeTab, setActiveTab] = useState<'schedule' | 'fairness'>('schedule');

  function handleCellClick(nightId: string, slotIdx: number) {
    setOverrideNight(nightId);
    setOverrideSlot(slotIdx);
  }

  function applyOverride(staffId: string) {
    if (overrideNight === null || overrideSlot === null) return;
    const newStaff = staff.find((s) => s.id === staffId);
    if (!newStaff) return;

    setLocalSchedule((prev) => ({
      ...prev,
      assignments: prev.assignments.map((a) => {
        if (a.night.id !== overrideNight) return a;
        const newAssigned = [...a.assigned];
        newAssigned[overrideSlot] = newStaff;
        return { ...a, assigned: newAssigned };
      }),
    }));
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

  return (
    <div className={styles.container}>
      <div className={styles.topBar}>
        <div className={styles.headerLeft}>
          <h2>Generated Schedule</h2>
          <span className={styles.meta}>
            {localSchedule.assignments.length} nights &middot; {staff.length} staff &middot; {perNight}/night
          </span>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.regenBtn} onClick={onRegenerate} type="button">
            Regenerate
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
          {spread > 1 && <span className={styles.warningDot} title="Weighted spread &gt; 1" />}
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
                    <th key={i} className={styles.odCol}>OD {i + 1}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {localSchedule.assignments.map(({ night, assigned }) => {
                  const nt = NIGHT_TYPE_MAP[night.typeId];
                  return (
                    <tr key={night.id}>
                      <td className={styles.nightLabel}>{night.label}</td>
                      <td>
                        <span className={`${styles.pill} ${styles[`pill-${nt.color}`]}`}>
                          {nt.shortLabel}
                        </span>
                      </td>
                      {assigned.map((s, idx) => (
                        <td
                          key={idx}
                          className={`${styles.staffCell} ${overrideNight === night.id && overrideSlot === idx ? styles.cellActive : ''}`}
                          onClick={() => handleCellClick(night.id, idx)}
                        >
                          <span className={styles.staffName}>{s.name}</span>
                          <span className={styles.staffBunk}>{s.bunk}</span>
                        </td>
                      ))}
                      {/* Pad if fewer than perNight */}
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
            <span className={`${styles.spreadValue} ${spread > 1 ? styles.spreadWarn : styles.spreadOk}`}>
              {spread.toFixed(2)}
            </span>
            <span className={styles.spreadHint}>
              ({spread <= 0.5 ? 'Excellent' : spread <= 1 ? 'Good' : 'Consider regenerating'})
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
                            <div
                              className={styles.bar}
                              style={{ width: `${pct}%` }}
                            />
                            <span className={styles.mono}>{stat.weightedTotal.toFixed(2)}</span>
                          </div>
                        </td>
                        {NIGHT_TYPES.map((nt) => (
                          <td key={nt.id} className={styles.typeCount}>
                            <span className={styles.mono}>{stat.byType[nt.id as NightTypeId]}</span>
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

      {/* Override modal */}
      {overrideNight !== null && overrideSlot !== null && (
        <div className={styles.modalOverlay} onClick={() => { setOverrideNight(null); setOverrideSlot(null); }}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h3>Swap staff member</h3>
              <button
                className={styles.modalClose}
                onClick={() => { setOverrideNight(null); setOverrideSlot(null); }}
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
