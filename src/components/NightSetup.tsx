import { useState } from 'react';
import type { Night, NightTypeId } from '../types';
import { NIGHT_TYPES, NIGHT_TYPE_MAP } from '../utils/scheduler';
import { SESSION_1_2026 } from '../utils/presets';
import styles from './NightSetup.module.css';

interface Props {
  nights: Night[];
  onNightsChange: (nights: Night[]) => void;
  onBack: () => void;
  onNext: () => void;
}

type SlotType = NightTypeId | 'allStaff';

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function nightColor(night: Night): string {
  if (night.allStaffOnDuty) return 'allstaff';
  return NIGHT_TYPE_MAP[night.typeId].color;
}

/** Maps a loose type string to a night definition, or returns null if unrecognized. */
function parseTypeStr(raw: string): { typeId: NightTypeId; allStaffOnDuty?: true } | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (s.includes('all staff')) return { typeId: 'closed', allStaffOnDuty: true };
  if (s.includes('meeting'))   return { typeId: 'closedMeeting' };
  if (s.includes('heavy'))     return { typeId: 'openHeavy' };
  if (s === 'closed')          return { typeId: 'closed' };
  if (s.startsWith('open'))    return { typeId: 'open' };
  return null;
}

export default function NightSetup({ nights, onNightsChange, onBack, onNext }: Props) {
  const [nextType, setNextType] = useState<SlotType>('closed');
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [showBulk, setShowBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [skippedCount, setSkippedCount] = useState<number | null>(null);
  const [showPresetConfirm, setShowPresetConfirm] = useState(false);

  function addDay() {
    const isAllStaff = nextType === 'allStaff';
    onNightsChange([
      ...nights,
      {
        id: generateId(),
        label: '',
        typeId: isAllStaff ? 'closed' : (nextType as NightTypeId),
        ...(isAllStaff ? { allStaffOnDuty: true } : {}),
      },
    ]);
  }

  function removeNight(id: string) {
    onNightsChange(nights.filter((n) => n.id !== id));
  }

  function updateNight(id: string, patch: Partial<Night>) {
    onNightsChange(nights.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }

  function applyBulk() {
    const lines = bulkText.split('\n').map((l) => l.trim()).filter(Boolean);
    const parsed: Night[] = [];
    let skip = 0;
    for (const line of lines) {
      const comma = line.indexOf(',');
      const typeStr = comma >= 0 ? line.slice(0, comma) : line;
      const note = comma >= 0 ? line.slice(comma + 1).trim() : '';
      const result = parseTypeStr(typeStr);
      if (!result) { skip++; continue; }
      parsed.push({
        id: generateId(),
        label: note,
        typeId: result.typeId,
        ...(result.allStaffOnDuty ? { allStaffOnDuty: true } : {}),
      });
    }
    if (parsed.length > 0) {
      onNightsChange([...nights, ...parsed]);
      setBulkText('');
      setShowBulk(false);
    }
    setSkippedCount(skip > 0 ? skip : null);
  }

  function clearAll() {
    if (confirm('Clear all days?')) onNightsChange([]);
  }

  function loadPreset() {
    if (nights.length > 0) {
      setShowPresetConfirm(true);
    } else {
      applyPreset();
    }
  }

  function applyPreset() {
    onNightsChange(SESSION_1_2026.map((n) => ({ ...n, id: generateId() })));
    setShowPresetConfirm(false);
  }

  function handleDragStart(id: string) { setDragId(id); }
  function handleDragEnter(id: string) { setDragOver(id); }
  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOver(null); return; }
    const from = nights.findIndex((n) => n.id === dragId);
    const to = nights.findIndex((n) => n.id === targetId);
    const reordered = [...nights];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    onNightsChange(reordered);
    setDragId(null);
    setDragOver(null);
  }

  // Summary counts
  const allStaffCount = nights.filter((n) => n.allStaffOnDuty).length;
  const regularNights = nights.filter((n) => !n.allStaffOnDuty);
  const typeCounts = Object.fromEntries(
    NIGHT_TYPES.map((nt) => [nt.id, 0])
  ) as Record<NightTypeId, number>;
  for (const n of regularNights) typeCounts[n.typeId]++;

  const canProceed = nights.some((n) => !n.allStaffOnDuty);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Day Schedule</h2>
        <p className={styles.subtitle}>
          Add days in order below. Drag rows to reorder. Change type inline.
        </p>
      </div>

      {nights.length > 0 && (
        <div className={styles.summary}>
          <span className={styles.summaryTotal}>
            {nights.length} {nights.length === 1 ? 'day' : 'days'}
          </span>
          {allStaffCount > 0 && (
            <span className={`${styles.pill} ${styles['pill-allstaff']}`}>
              {allStaffCount} All staff
            </span>
          )}
          {NIGHT_TYPES.map((nt) =>
            typeCounts[nt.id] > 0 ? (
              <span key={nt.id} className={`${styles.pill} ${styles[`pill-${nt.color}`]}`}>
                {typeCounts[nt.id]} {nt.shortLabel}
              </span>
            ) : null
          )}
          <button className={styles.clearBtn} onClick={clearAll} type="button">
            Clear all
          </button>
        </div>
      )}

      {/* Preset */}
      <div className={styles.presetRow}>
        <button className={styles.presetBtn} onClick={loadPreset} type="button">
          Load Session 1 2026
        </button>
        {showPresetConfirm && (
          <>
            <span className={styles.presetWarn}>This will replace your current nights.</span>
            <button className={styles.presetConfirmBtn} onClick={applyPreset} type="button">
              Confirm
            </button>
            <button className={styles.presetCancelBtn} onClick={() => setShowPresetConfirm(false)} type="button">
              Cancel
            </button>
          </>
        )}
      </div>

      {/* Bulk import */}
      <div>
        <div className={styles.bulkToggleRow}>
          <button
            className={styles.bulkBtn}
            onClick={() => { setShowBulk(!showBulk); setSkippedCount(null); }}
            type="button"
          >
            {showBulk ? 'Hide bulk add' : 'Bulk add days'}
          </button>
          {skippedCount !== null && skippedCount > 0 && (
            <span className={styles.skippedWarn}>
              Skipped {skippedCount} unrecognized line{skippedCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
        {showBulk && (
          <div className={styles.bulkBox}>
            <p className={styles.bulkHint}>
              One per line: <code>Type</code> or <code>Type, Note</code>
              <br />
              Types: <code>closed</code>, <code>open</code>, <code>heavy</code>,{' '}
              <code>closed meeting</code>, <code>all staff on duty</code>
            </p>
            <textarea
              className={styles.bulkTextarea}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={7}
              placeholder={'closed, arrival day\nopen\nclosed meeting\nopen\nopen\nheavy\nheavy'}
            />
            <button className={styles.applyBtn} onClick={applyBulk} type="button">
              Add to list
            </button>
          </div>
        )}
      </div>

      <div className={styles.nightList}>
        {nights.length > 0 && (
          <div className={styles.listHeader}>
            <span />
            <span>Day</span>
            <span>Type</span>
            <span>Note</span>
            <span />
          </div>
        )}

        {nights.map((night, idx) => (
          <div
            key={night.id}
            className={[
              styles.nightRow,
              night.allStaffOnDuty ? styles.allStaffRow : '',
              dragOver === night.id ? styles.dragTarget : '',
              dragId === night.id ? styles.dragging : '',
            ].filter(Boolean).join(' ')}
            draggable
            onDragStart={() => handleDragStart(night.id)}
            onDragEnter={() => handleDragEnter(night.id)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => handleDrop(night.id)}
            onDragEnd={() => { setDragId(null); setDragOver(null); }}
          >
            <span className={styles.dragHandle}>⣿</span>
            <span className={styles.dayNum}>Day {idx + 1}</span>
            <select
              className={`${styles.typeSelect} ${styles[`type-${nightColor(night)}`]}`}
              value={night.allStaffOnDuty ? 'allStaff' : night.typeId}
              onChange={(e) => {
                const val = e.target.value;
                if (val === 'allStaff') {
                  updateNight(night.id, { allStaffOnDuty: true, typeId: 'closed' });
                } else {
                  updateNight(night.id, { allStaffOnDuty: undefined, typeId: val as NightTypeId });
                }
              }}
            >
              {NIGHT_TYPES.map((nt) => (
                <option key={nt.id} value={nt.id}>
                  {nt.label} (×{nt.weight})
                </option>
              ))}
              <option value="allStaff">All staff on duty</option>
            </select>
            <input
              className={styles.noteInput}
              value={night.label}
              onChange={(e) => updateNight(night.id, { label: e.target.value })}
              placeholder="optional note"
              disabled={!!night.allStaffOnDuty}
            />
            <button
              className={styles.removeBtn}
              onClick={() => removeNight(night.id)}
              type="button"
            >
              &times;
            </button>
          </div>
        ))}

        {/* Persistent add-next-day row */}
        <div className={styles.addDayRow}>
          <select
            className={styles.addSelect}
            value={nextType}
            onChange={(e) => setNextType(e.target.value as SlotType)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDay(); } }}
          >
            {NIGHT_TYPES.map((nt) => (
              <option key={nt.id} value={nt.id}>
                {nt.label} (×{nt.weight})
              </option>
            ))}
            <option value="allStaff">All staff on duty</option>
          </select>
          <button className={styles.addBtn} onClick={addDay} type="button">
            + Add Day {nights.length + 1}
          </button>
        </div>
      </div>

      <div className={styles.footer}>
        <button className={styles.backBtn} onClick={onBack} type="button">
          &larr; Back
        </button>
        {nights.length === 0 && (
          <p className={styles.warning}>Add at least one day to continue.</p>
        )}
        {nights.length > 0 && !canProceed && (
          <p className={styles.warning}>Add at least one non-all-staff day.</p>
        )}
        <button
          className={styles.nextBtn}
          onClick={onNext}
          disabled={!canProceed}
          type="button"
        >
          Generate Schedule &rarr;
        </button>
      </div>
    </div>
  );
}
