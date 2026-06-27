import { useState, useCallback } from 'react';
import type { Staff, Night, AppStep, GeneratedSchedule, FrozenAssignment, LockedOutAssignment } from './types';
import { generateSchedule } from './utils/scheduler';
import { useLocalStorage } from './hooks/useLocalStorage';
import StaffSetup from './components/StaffSetup';
import NightSetup from './components/NightSetup';
import ScheduleResults from './components/ScheduleResults';
import styles from './App.module.css';

const STEPS: { id: AppStep; label: string }[] = [
  { id: 'setup-staff', label: 'Staff' },
  { id: 'setup-nights', label: 'Nights' },
  { id: 'generate', label: 'Generate' },
];

export default function App() {
  const [step, setStep] = useLocalStorage<AppStep>('scheduler-step', 'setup-staff');
  const [staff, setStaff] = useLocalStorage<Staff[]>('scheduler-staff', []);
  const [nights, setNights] = useLocalStorage<Night[]>('scheduler-nights', []);
  const [perNight, setPerNight] = useLocalStorage<number>('scheduler-per-night', 3);
  const [bunkRestriction, setBunkRestriction] = useLocalStorage<boolean>('scheduler-bunk-restriction', false);
  const [schedule, setSchedule] = useState<GeneratedSchedule | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runGenerate = useCallback((frozen: FrozenAssignment[] = [], lockedOut: LockedOutAssignment[] = []) => {
    setGenerating(true);
    setError(null);
    // Defer to next tick so spinner can render
    setTimeout(() => {
      try {
        const result = generateSchedule(
          {
            staff,
            nights,
            perNight,
            bunkRestriction,
            frozenAssignments: Array.isArray(frozen) ? frozen : [],
            lockedOutAssignments: Array.isArray(lockedOut) ? lockedOut : [],
          },
          800
        );
        setSchedule(result);
        setStep('generate');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setGenerating(false);
      }
    }, 30);
  }, [staff, nights, perNight, bunkRestriction, setStep]);

  function handleRegenerate(frozen: FrozenAssignment[], lockedOut: LockedOutAssignment[]) {
    runGenerate(frozen, lockedOut);
  }

  function resetAll() {
    if (confirm('Reset everything and start over?')) {
      setStaff([]);
      setNights([]);
      setPerNight(3);
      setBunkRestriction(false);
      setSchedule(null);
      setStep('setup-staff');
    }
  }

  // If we persisted 'generate' step but schedule is gone (e.g. page refresh), fall back to nights.
  const effectiveStep: AppStep = (step === 'generate' && !schedule) ? 'setup-nights' : step;

  const currentStepIndex = STEPS.findIndex((s) => s.id === effectiveStep);

  function isNavigable(i: number): boolean {
    if (i === 0) return true;
    if (i === 1) return staff.length >= perNight;
    if (i === 2) return schedule !== null;
    return false;
  }

  function handleStepClick(i: number) {
    if (!isNavigable(i)) return;
    if (STEPS[i].id === effectiveStep) return;
    setStep(STEPS[i].id);
  }

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <div className={styles.brand}>
            <span className={styles.brandIcon}>🏕</span>
            <div>
              <h1 className={styles.brandName}>OD Scheduler</h1>
              <span className={styles.brandSub}>Camp Seneca Lake</span>
            </div>
          </div>
          <nav className={styles.steps}>
            {STEPS.map((s, i) => {
              const navigable = isNavigable(i);
              return (
                <div
                  key={s.id}
                  className={`${styles.stepItem} ${
                    i === currentStepIndex
                      ? styles.stepActive
                      : i < currentStepIndex
                      ? styles.stepDone
                      : styles.stepFuture
                  } ${navigable && i !== currentStepIndex ? styles.stepClickable : styles.stepUnclickable}`}
                  onClick={() => handleStepClick(i)}
                >
                  <span className={styles.stepNum}>{i + 1}</span>
                  <span className={styles.stepLabel}>{s.label}</span>
                </div>
              );
            })}
          </nav>
          <button className={styles.resetBtn} onClick={resetAll} type="button">
            Restart
          </button>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.card}>
          {effectiveStep === 'setup-staff' && (
            <StaffSetup
              staff={staff}
              perNight={perNight}
              bunkRestriction={bunkRestriction}
              onStaffChange={setStaff}
              onPerNightChange={setPerNight}
              onBunkRestrictionChange={setBunkRestriction}
              onNext={() => setStep('setup-nights')}
            />
          )}

          {effectiveStep === 'setup-nights' && (
            <NightSetup
              nights={nights}
              staff={staff}
              onNightsChange={setNights}
              onBack={() => setStep('setup-staff')}
              onNext={runGenerate}
            />
          )}

          {effectiveStep === 'generate' && schedule && (
            <ScheduleResults
              schedule={schedule}
              staff={staff}
              perNight={perNight}
              bunkRestriction={bunkRestriction}
              onRegenerate={handleRegenerate}
              onNewSchedule={() => { setSchedule(null); setStep('setup-staff'); }}
              onBack={() => setStep('setup-nights')}
            />
          )}

          {generating && (
            <div className={styles.generatingOverlay}>
              <div className={styles.spinner} />
              <p>Finding the fairest schedule&hellip;</p>
            </div>
          )}

          {error && (
            <div className={styles.errorBox}>
              <strong>Could not generate schedule:</strong> {error}
            </div>
          )}
        </div>
      </main>

      <footer className={styles.footer}>
        <span>scheduler.joshbcohn.com</span>
      </footer>
    </div>
  );
}
