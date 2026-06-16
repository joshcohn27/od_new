import { useState } from 'react';
import type { Night, NightTypeId } from '../types';
import { NIGHT_TYPES } from '../utils/scheduler';
import styles from './NightSetup.module.css';

interface Props {
  nights: Night[];
  onNightsChange: (nights: Night[]) => void;
  onBack: () => void;
  onNext: () => void;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}


export default function NightSetup({ nights, onNightsChange, onBack, onNext }: Props) {
  const [bulkCounts, setBulkCounts] = useState<Record<NightTypeId, number>>(
    Object.fromEntries(NIGHT_TYPES.map((nt) => [nt.id, 0])) as Record<NightTypeId, number>
  );
  const [bulkPrefix, setBulkPrefix] = useState('Night');
  const [showBulk, setShowBulk] = useState(nights.length === 0);
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  function generateBulk() {
    const newNights: Night[] = [];
    let counter = nights.length + 1;
    for (const nt of NIGHT_TYPES) {
      for (let i = 0; i < bulkCounts[nt.id]; i++) {
        newNights.push({
          id: generateId(),
          label: `${bulkPrefix} ${counter++}`,
          typeId: nt.id,
        });
      }
    }
    // Sort by type weight so nights are in a sensible default order
    // Actually keep insertion order (user can reorder)
    onNightsChange([...nights, ...newNights]);
    setShowBulk(false);
  }

  function addNight() {
    onNightsChange([
      ...nights,
      { id: generateId(), label: `Night ${nights.length + 1}`, typeId: 'open' },
    ]);
  }

  function removeNight(id: string) {
    onNightsChange(nights.filter((n) => n.id !== id));
  }

  function updateNight(id: string, field: keyof Night, value: string) {
    onNightsChange(
      nights.map((n) => (n.id === id ? { ...n, [field]: value } : n))
    );
  }

  function clearAll() {
    if (confirm('Clear all nights?')) {
      onNightsChange([]);
      setShowBulk(true);
    }
  }

  // Drag-to-reorder
  function handleDragStart(id: string) {
    setDragId(id);
  }

  function handleDragEnter(id: string) {
    setDragOver(id);
  }

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDragOver(null);
      return;
    }
    const from = nights.findIndex((n) => n.id === dragId);
    const to = nights.findIndex((n) => n.id === targetId);
    const reordered = [...nights];
    const [moved] = reordered.splice(from, 1);
    reordered.splice(to, 0, moved);
    onNightsChange(reordered);
    setDragId(null);
    setDragOver(null);
  }

  const totalBulk = Object.values(bulkCounts).reduce((a, b) => a + b, 0);
  const canProceed = nights.length > 0;

  // Summary counts
  const typeCounts = Object.fromEntries(NIGHT_TYPES.map((nt) => [nt.id, 0])) as Record<NightTypeId, number>;
  for (const n of nights) typeCounts[n.typeId]++;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Night Schedule</h2>
        <p className={styles.subtitle}>Define each night and its type. Drag rows to reorder.</p>
      </div>

      {/* Summary pills */}
      {nights.length > 0 && (
        <div className={styles.summary}>
          <span className={styles.summaryTotal}>{nights.length} nights</span>
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

      {/* Bulk generator */}
      <div className={styles.bulkSection}>
        <button
          className={styles.bulkToggle}
          onClick={() => setShowBulk(!showBulk)}
          type="button"
        >
          {showBulk ? '- Hide quick setup' : '+ Quick setup'}
        </button>
        {showBulk && (
          <div className={styles.bulkBox}>
            <div className={styles.bulkPrefixRow}>
              <label className={styles.bulkLabel}>Night label prefix</label>
              <input
                className={styles.prefixInput}
                value={bulkPrefix}
                onChange={(e) => setBulkPrefix(e.target.value)}
              />
            </div>
            <div className={styles.bulkGrid}>
              {NIGHT_TYPES.map((nt) => (
                <div key={nt.id} className={styles.bulkItem}>
                  <span className={`${styles.pill} ${styles[`pill-${nt.color}`]}`}>
                    {nt.label}
                  </span>
                  <span className={styles.weightTag}>×{nt.weight}</span>
                  <input
                    type="number"
                    min={0}
                    className={styles.bulkCountInput}
                    value={bulkCounts[nt.id]}
                    onChange={(e) =>
                      setBulkCounts((prev) => ({
                        ...prev,
                        [nt.id]: Math.max(0, parseInt(e.target.value) || 0),
                      }))
                    }
                  />
                </div>
              ))}
            </div>
            <button
              className={styles.generateBtn}
              onClick={generateBulk}
              disabled={totalBulk === 0}
              type="button"
            >
              Add {totalBulk > 0 ? totalBulk : ''} nights
            </button>
          </div>
        )}
      </div>

      {/* Night list */}
      {nights.length > 0 && (
        <div className={styles.nightList}>
          <div className={styles.listHeader}>
            <span className={styles.colLabel}>Label</span>
            <span className={styles.colType}>Type</span>
            <span></span>
          </div>
          <p className={styles.dragHint}>Drag rows to reorder</p>
          {nights.map((night) => (
            <div
              key={night.id}
              className={`${styles.nightRow} ${dragOver === night.id ? styles.dragTarget : ''} ${dragId === night.id ? styles.dragging : ''}`}
              draggable
              onDragStart={() => handleDragStart(night.id)}
              onDragEnter={() => handleDragEnter(night.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(night.id)}
              onDragEnd={() => { setDragId(null); setDragOver(null); }}
            >
              <span className={styles.dragHandle}>⣿</span>
              <input
                className={styles.labelInput}
                value={night.label}
                onChange={(e) => updateNight(night.id, 'label', e.target.value)}
              />
              <select
                className={`${styles.typeSelect} ${styles[`type-${NIGHT_TYPES.find(nt => nt.id === night.typeId)?.color}`]}`}
                value={night.typeId}
                onChange={(e) => updateNight(night.id, 'typeId', e.target.value as NightTypeId)}
              >
                {NIGHT_TYPES.map((nt) => (
                  <option key={nt.id} value={nt.id}>
                    {nt.label} (×{nt.weight})
                  </option>
                ))}
              </select>
              <button
                className={styles.removeBtn}
                onClick={() => removeNight(night.id)}
                type="button"
              >
                &times;
              </button>
            </div>
          ))}
          <button className={styles.addNightBtn} onClick={addNight} type="button">
            + Add night
          </button>
        </div>
      )}

      <div className={styles.footer}>
        <button className={styles.backBtn} onClick={onBack} type="button">
          &larr; Back
        </button>
        {!canProceed && (
          <p className={styles.warning}>Add at least one night to continue.</p>
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
