import { useState } from 'react';
import type { Staff } from '../types';
import styles from './StaffSetup.module.css';

interface Props {
  staff: Staff[];
  perNight: number;
  bunkRestriction: boolean;
  onStaffChange: (staff: Staff[]) => void;
  onPerNightChange: (n: number) => void;
  onBunkRestrictionChange: (v: boolean) => void;
  onNext: () => void;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function parseBulk(raw: string, existingBunks: string[]): Staff[] {
  // Format: one per line, "Name, Bunk" or just "Name"
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(',').map((p) => p.trim());
      return {
        id: generateId(),
        name: parts[0] || '',
        bunk: parts[1] || existingBunks[0] || '',
      };
    })
    .filter((s) => s.name);
}

export default function StaffSetup({
  staff,
  perNight,
  bunkRestriction,
  onStaffChange,
  onPerNightChange,
  onBunkRestrictionChange,
  onNext,
}: Props) {
  const [bulkText, setBulkText] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [newName, setNewName] = useState('');
  const [newBunk, setNewBunk] = useState('');

  // Derive unique bunks from current staff
  const bunks = Array.from(new Set(staff.map((s) => s.bunk).filter(Boolean))).sort();

  function addOne() {
    if (!newName.trim()) return;
    onStaffChange([
      ...staff,
      { id: generateId(), name: newName.trim(), bunk: newBunk.trim() },
    ]);
    setNewName('');
    setNewBunk('');
  }

  function removeStaff(id: string) {
    onStaffChange(staff.filter((s) => s.id !== id));
  }

  function updateStaff(id: string, field: keyof Staff, value: string) {
    onStaffChange(staff.map((s) => (s.id === id ? { ...s, [field]: value } : s)));
  }

  function applyBulk() {
    const parsed = parseBulk(bulkText, bunks);
    if (parsed.length) {
      onStaffChange([...staff, ...parsed]);
      setBulkText('');
      setShowBulk(false);
    }
  }

  const canProceed = staff.length >= perNight;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>Staff Roster</h2>
        <p className={styles.subtitle}>Add staff members and their bunk assignments.</p>
      </div>

      <div className={styles.globalConfig}>
        <label className={styles.configItem}>
          <span>Staff on duty per night</span>
          <input
            type="number"
            min={1}
            max={10}
            value={perNight}
            onChange={(e) => onPerNightChange(Math.max(1, parseInt(e.target.value) || 1))}
            className={styles.numberInput}
          />
        </label>
        <label className={styles.configItem}>
          <span>Bunk restriction</span>
          <div className={styles.toggleRow}>
            <button
              className={`${styles.toggle} ${bunkRestriction ? styles.toggleOn : ''}`}
              onClick={() => onBunkRestrictionChange(!bunkRestriction)}
              type="button"
            >
              {bunkRestriction ? 'On' : 'Off'}
            </button>
            <div>
              <span className={styles.toggleHint}>
                {bunkRestriction
                  ? 'Staff can only OD their own bunk'
                  : 'Staff can OD any night'}
              </span>
              <span className={styles.bunkHint}>
                When on, OD slot number matches bunk number (e.g. bunk M1, O1, S1 all fill OD slot 1).
              </span>
            </div>
          </div>
        </label>
      </div>

      <div className={styles.rosterSection}>
        <div className={styles.rosterHeader}>
          <span className={styles.rosterCount}>{staff.length} staff</span>
          <button
            className={styles.bulkBtn}
            onClick={() => setShowBulk(!showBulk)}
            type="button"
          >
            {showBulk ? 'Hide bulk import' : 'Bulk import'}
          </button>
        </div>

        {showBulk && (
          <div className={styles.bulkBox}>
            <p className={styles.bulkHint}>One per line: <code>Name, Bunk</code></p>
            <textarea
              className={styles.bulkTextarea}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              placeholder={'Alice, Cabin A\nBob, Cabin B\nCarol, Cabin A'}
              rows={6}
            />
            <button className={styles.applyBtn} onClick={applyBulk} type="button">
              Add to roster
            </button>
          </div>
        )}

        <div className={styles.addRow}>
          <input
            className={styles.nameInput}
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
              if (e.target.value && !newBunk && staff.length > 0) {
                setNewBunk(staff[staff.length - 1].bunk);
              }
            }}
            onKeyDown={(e) => e.key === 'Enter' && addOne()}
            placeholder="Name"
          />
          <input
            className={styles.bunkInput}
            value={newBunk}
            onChange={(e) => setNewBunk(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addOne()}
            placeholder="Bunk"
            list="bunk-suggestions"
          />
          <datalist id="bunk-suggestions">
            {bunks.map((b) => <option key={b} value={b} />)}
          </datalist>
          <button className={styles.addBtn} onClick={addOne} type="button">
            Add
          </button>
        </div>

        {staff.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Name</th>
                <th>Bunk</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input
                      className={styles.inlineInput}
                      value={s.name}
                      onChange={(e) => updateStaff(s.id, 'name', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      className={styles.inlineInput}
                      value={s.bunk}
                      onChange={(e) => updateStaff(s.id, 'bunk', e.target.value)}
                      list="bunk-suggestions"
                    />
                  </td>
                  <td>
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeStaff(s.id)}
                      type="button"
                    >
                      &times;
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className={styles.footer}>
        {!canProceed && (
          <p className={styles.warning}>
            Add at least {perNight} staff members to continue.
          </p>
        )}
        <button
          className={styles.nextBtn}
          onClick={onNext}
          disabled={!canProceed}
          type="button"
        >
          Next: Set Up Nights &rarr;
        </button>
      </div>
    </div>
  );
}
