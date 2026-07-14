/**
 * scripts/stress-test-scheduler.ts
 *
 * Standalone stress-test harness for the OD scheduler.
 * Run:  npx tsx scripts/stress-test-scheduler.ts
 *
 * Generates all dummy data internally — no real roster needed.
 * Results show best-of-500 runs per scenario (generateSchedule uses internal
 * randomness, so spread/floor metrics may vary by ±0.2 across re-runs).
 * Input data (staff lists, night sequences) are fully deterministic via fixed seeds.
 */

import { generateSchedule, getBunkNumber } from '../src/utils/scheduler';
import type {
  Staff,
  Night,
  ScheduleConfig,
  GeneratedSchedule,
  NightTypeId,
} from '../src/types';

// ─── Seeded PRNG (LCG — reproducible per scenario) ───────────────────────────

function seedRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function shuffle<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Dummy data generators ────────────────────────────────────────────────────

/**
 * Generates Staff[] with sequential names.
 * bunkSizeDistribution[i] is the number of staff in bunk slot i+1.
 * Must sum to count. Randomly marks flexiblePercent fraction as flexibleBunk.
 */
function makeDummyStaff(
  count: number,
  bunkSizeDistribution: number[],
  flexiblePercent: number,
  seed: number
): Staff[] {
  const rng = seedRng(seed);
  const staff: Staff[] = [];
  let idx = 1;

  for (let slot = 0; slot < bunkSizeDistribution.length; slot++) {
    for (let i = 0; i < bunkSizeDistribution[slot]; i++) {
      staff.push({ id: `s${idx}`, name: `Staff ${idx}`, bunk: `M${slot + 1}` });
      idx++;
    }
  }

  // Guard against distribution mismatch — trim or pad to exactly `count`.
  while (staff.length < count) {
    const lastSlot = bunkSizeDistribution.length;
    staff.push({ id: `s${idx}`, name: `Staff ${idx}`, bunk: `M${lastSlot}` });
    idx++;
  }
  if (staff.length > count) staff.length = count;

  // Mark a random subset as flexibleBunk.
  const flexCount = Math.round(count * flexiblePercent);
  if (flexCount > 0) {
    const indices = shuffle(
      Array.from({ length: count }, (_, i) => i),
      rng
    ).slice(0, flexCount);
    for (const i of indices) {
      staff[i] = { ...staff[i], flexibleBunk: true };
    }
  }

  return staff;
}

/**
 * Generates Night[] with heavy/meeting nights spread at reasonable intervals.
 * ~20% of nights get 1-2 randomly unavailable staff to simulate real conditions.
 */
function makeDummyNights(
  totalNights: number,
  heavyCount: number,
  meetingCount: number,
  closedRatio: number,
  allStaff: Staff[],
  seed: number
): Night[] {
  const rng = seedRng(seed + 1000);

  // Candidate positions for special nights: avoid index 0 and last.
  const eligible = shuffle(
    Array.from({ length: Math.max(0, totalNights - 2) }, (_, i) => i + 1),
    rng
  );
  const heavyPositions = new Set(eligible.slice(0, heavyCount));
  const meetingPositions = new Set(eligible.slice(heavyCount, heavyCount + meetingCount));

  // Nights that get unavailability (~20% of total, each affecting 1-2 staff).
  const unavailSet = new Set(
    shuffle(Array.from({ length: totalNights }, (_, i) => i), rng).slice(
      0,
      Math.max(1, Math.round(totalNights * 0.2))
    )
  );

  const nights: Night[] = [];

  for (let i = 0; i < totalNights; i++) {
    let typeId: NightTypeId;
    if (heavyPositions.has(i)) {
      typeId = 'openHeavy';
    } else if (meetingPositions.has(i)) {
      typeId = 'closedMeeting';
    } else {
      typeId = rng() < closedRatio ? 'closed' : 'open';
    }

    const unavailableStaffIds: string[] = [];
    if (unavailSet.has(i) && allStaff.length > 0) {
      const n = rng() < 0.5 ? 1 : 2;
      const shuffled = shuffle(allStaff, rng);
      for (let k = 0; k < Math.min(n, shuffled.length); k++) {
        unavailableStaffIds.push(shuffled[k].id);
      }
    }

    nights.push({ id: `n${i + 1}`, label: `Night ${i + 1}`, typeId, unavailableStaffIds });
  }

  return nights;
}

// ─── Metric computation ───────────────────────────────────────────────────────

interface Metrics {
  weightedSpread: number;
  achievableFloor: number;
  rawSpread: number;
  heavySpread: number;
  hardFail: boolean;
  unfillable: boolean;
  flexCrossBunk: number; // nights a flexible staffer covered a non-home slot
}

function computeMetrics(schedule: GeneratedSchedule, config: ScheduleConfig): Metrics {
  const { stats, assignments } = schedule;

  const weights = stats.map((s) => s.weightedTotal);
  const weightedSpread = Math.max(...weights) - Math.min(...weights);

  const counts = stats.map((s) => s.total);
  const rawSpread = Math.max(...counts) - Math.min(...counts);

  const heavyCounts = stats.map((s) => s.byType.openHeavy);
  const heavySpread = Math.max(...heavyCounts) - Math.min(...heavyCounts);

  // Replicate validateSchedule's achievableFloor logic exactly.
  let achievableFloor = 0.5;
  if (config.bunkRestriction) {
    const groupSizes = new Map<number, number>();
    for (const s of config.staff) {
      const n = getBunkNumber(s.bunk);
      groupSizes.set(n, (groupSizes.get(n) ?? 0) + 1);
    }
    const sizes = Array.from(groupSizes.values());
    if (sizes.length > 1) {
      const totalWeight = stats.reduce((a, s) => a + s.weightedTotal, 0);
      const avgWeight = totalWeight / stats.length;
      const maxSize = Math.max(...sizes);
      const minSize = Math.min(...sizes);
      const structuralGap = avgWeight * (maxSize / minSize - 1);
      const flexCount = config.staff.filter((s) => s.flexibleBunk).length;
      achievableFloor = Math.max(achievableFloor, structuralGap * (flexCount > 0 ? 1.25 : 1.15));
    }
  }

  // Hard fail: consecutive nights (frozen logic omitted — no frozen in test scenarios).
  const scored = assignments.filter((a) => !a.night.allStaffOnDuty);
  let hardFail = false;
  outer: for (let i = 1; i < scored.length; i++) {
    const prevIds = new Set(scored[i - 1].assigned.map((s) => s.id));
    for (const s of scored[i].assigned) {
      if (prevIds.has(s.id)) {
        hardFail = true;
        break outer;
      }
    }
  }
  // Slot integrity.
  if (config.bunkRestriction && !hardFail) {
    slotCheck: for (const { assigned } of scored) {
      for (let idx = 0; idx < assigned.length; idx++) {
        const s = assigned[idx];
        if (getBunkNumber(s.bunk) !== idx + 1 && !s.flexibleBunk) {
          hardFail = true;
          break slotCheck;
        }
      }
    }
  }

  const unfillable = assignments.some((a) => a.unfillable);

  // Count nights a flexible staffer was placed outside their home slot.
  let flexCrossBunk = 0;
  if (config.bunkRestriction) {
    for (const { assigned } of scored) {
      for (let idx = 0; idx < assigned.length; idx++) {
        const s = assigned[idx];
        if (s.flexibleBunk && getBunkNumber(s.bunk) !== idx + 1) flexCrossBunk++;
      }
    }
  }

  return { weightedSpread, achievableFloor, rawSpread, heavySpread, hardFail, unfillable, flexCrossBunk };
}

// ─── Scenario runner ──────────────────────────────────────────────────────────

interface Scenario {
  label: string;
  staffCount: number;
  distribution: number[];
  perNight: number;
  bunkRestriction: boolean;
  totalNights: number;
  heavyCount: number;
  flexiblePercent: number;
  seed: number;
}

interface ScenarioResult extends Scenario, Metrics {
  flags: string[];
  error?: string;
}

function runScenario(scenario: Scenario, runs = 500): ScenarioResult {
  const {
    staffCount, distribution, flexiblePercent,
    perNight, bunkRestriction, totalNights, heavyCount, seed,
  } = scenario;

  const meetingCount = Math.max(0, Math.round(totalNights / 7));
  const staff = makeDummyStaff(staffCount, distribution, flexiblePercent, seed);
  const nights = makeDummyNights(totalNights, heavyCount, meetingCount, 0.4, staff, seed);
  const config: ScheduleConfig = { staff, nights, perNight, bunkRestriction };

  // Silence scheduler's internal logging during batch runs.
  const origLog = console.log;
  const origWarn = console.warn;
  console.log = () => {};
  console.warn = () => {};

  let schedule: GeneratedSchedule;
  let error: string | undefined;
  try {
    schedule = generateSchedule(config, runs);
  } catch (e) {
    console.log = origLog;
    console.warn = origWarn;
    error = String(e);
    return { ...scenario, weightedSpread: 0, achievableFloor: 0, rawSpread: 0, heavySpread: 0, hardFail: true, unfillable: true, flexCrossBunk: 0, flags: ['ERROR'], error };
  } finally {
    console.log = origLog;
    console.warn = origWarn;
  }

  const metrics = computeMetrics(schedule, config);

  const flags: string[] = [];
  if (metrics.hardFail) flags.push('HARD');
  if (metrics.weightedSpread > metrics.achievableFloor * 1.20) flags.push('SPREAD');
  if (metrics.heavySpread > 1) flags.push('HEAVY');
  if (metrics.unfillable) flags.push('UNFILL');

  return { ...scenario, ...metrics, flags };
}

// ─── Scenario definitions  (25-40 representative cases) ──────────────────────
//
// perNight also equals number of bunk slots when bunkRestriction=true,
// so distribution.length must equal perNight in those rows.

const scenarios: Scenario[] = [
  // ── Group A: baseline, bunk restriction, even distribution ──
  { label: 'A1', staffCount: 12, distribution: [3,3,3,3], perNight: 4, bunkRestriction: true,  totalNights: 15, heavyCount: 2, flexiblePercent: 0,    seed: 1001 },
  { label: 'A2', staffCount: 18, distribution: [6,6,6],   perNight: 3, bunkRestriction: true,  totalNights: 20, heavyCount: 2, flexiblePercent: 0,    seed: 1002 },
  { label: 'A3', staffCount: 23, distribution: [5,6,6,6], perNight: 4, bunkRestriction: true,  totalNights: 27, heavyCount: 2, flexiblePercent: 0,    seed: 1003 },
  { label: 'A4', staffCount: 30, distribution: [7,8,8,7], perNight: 4, bunkRestriction: true,  totalNights: 35, heavyCount: 4, flexiblePercent: 0,    seed: 1004 },

  // ── Group B: bunk restriction OFF ──
  { label: 'B1', staffCount: 23, distribution: [5,6,6,6], perNight: 4, bunkRestriction: false, totalNights: 27, heavyCount: 2, flexiblePercent: 0,    seed: 1011 },
  { label: 'B2', staffCount: 18, distribution: [4,6,8],   perNight: 3, bunkRestriction: false, totalNights: 20, heavyCount: 2, flexiblePercent: 0,    seed: 1012 },

  // ── Group C: moderately uneven bunks ──
  { label: 'C1', staffCount: 18, distribution: [5,6,7],   perNight: 3, bunkRestriction: true,  totalNights: 20, heavyCount: 2, flexiblePercent: 0,    seed: 1021 },
  { label: 'C2', staffCount: 23, distribution: [5,5,6,7], perNight: 4, bunkRestriction: true,  totalNights: 27, heavyCount: 2, flexiblePercent: 0,    seed: 1022 },
  { label: 'C3', staffCount: 30, distribution: [6,7,8,9], perNight: 4, bunkRestriction: true,  totalNights: 35, heavyCount: 2, flexiblePercent: 0,    seed: 1023 },

  // ── Group D: heavily uneven bunks ──
  { label: 'D1', staffCount: 18, distribution: [4,6,8],   perNight: 3, bunkRestriction: true,  totalNights: 20, heavyCount: 2, flexiblePercent: 0,    seed: 1031 },
  { label: 'D2', staffCount: 23, distribution: [4,6,8,5], perNight: 4, bunkRestriction: true,  totalNights: 27, heavyCount: 2, flexiblePercent: 0,    seed: 1032 },
  { label: 'D3', staffCount: 23, distribution: [4,6,8,5], perNight: 4, bunkRestriction: true,  totalNights: 27, heavyCount: 4, flexiblePercent: 0,    seed: 1033 },

  // ── Group E: stress — small staff + uneven + high heavy count ──
  { label: 'E1', staffCount: 12, distribution: [2,4,6],   perNight: 3, bunkRestriction: true,  totalNights: 15, heavyCount: 4, flexiblePercent: 0,    seed: 1041 },
  { label: 'E2', staffCount: 12, distribution: [2,4,6],   perNight: 3, bunkRestriction: true,  totalNights: 20, heavyCount: 4, flexiblePercent: 0,    seed: 1042 },
  { label: 'E3', staffCount: 12, distribution: [3,3,3,3], perNight: 4, bunkRestriction: true,  totalNights: 15, heavyCount: 4, flexiblePercent: 0,    seed: 1043 },

  // ── Group F: perNight=2 ──
  { label: 'F1', staffCount: 18, distribution: [9,9],     perNight: 2, bunkRestriction: true,  totalNights: 20, heavyCount: 2, flexiblePercent: 0,    seed: 1051 },
  { label: 'F2', staffCount: 18, distribution: [6,12],    perNight: 2, bunkRestriction: true,  totalNights: 20, heavyCount: 2, flexiblePercent: 0,    seed: 1052 },
  { label: 'F3', staffCount: 30, distribution: [12,18],   perNight: 2, bunkRestriction: true,  totalNights: 27, heavyCount: 2, flexiblePercent: 0,    seed: 1053 },

  // ── Group G: zero heavy nights ──
  { label: 'G1', staffCount: 23, distribution: [5,6,6,6], perNight: 4, bunkRestriction: true,  totalNights: 27, heavyCount: 0, flexiblePercent: 0,    seed: 1061 },
  { label: 'G2', staffCount: 18, distribution: [4,6,8],   perNight: 3, bunkRestriction: true,  totalNights: 20, heavyCount: 0, flexiblePercent: 0,    seed: 1062 },

  // ── Group H: many nights / high heavy count ──
  { label: 'H1', staffCount: 23, distribution: [5,6,6,6], perNight: 4, bunkRestriction: true,  totalNights: 35, heavyCount: 4, flexiblePercent: 0,    seed: 1071 },
  { label: 'H2', staffCount: 30, distribution: [7,8,8,7], perNight: 4, bunkRestriction: true,  totalNights: 35, heavyCount: 4, flexiblePercent: 0,    seed: 1072 },

  // ── Group I: flexible staff ──
  { label: 'I1', staffCount: 23, distribution: [5,6,6,6], perNight: 4, bunkRestriction: true,  totalNights: 27, heavyCount: 2, flexiblePercent: 0.10, seed: 1081 },
  { label: 'I2', staffCount: 23, distribution: [5,6,6,6], perNight: 4, bunkRestriction: true,  totalNights: 27, heavyCount: 2, flexiblePercent: 0.25, seed: 1082 },
  { label: 'I3', staffCount: 23, distribution: [4,6,8,5], perNight: 4, bunkRestriction: true,  totalNights: 27, heavyCount: 2, flexiblePercent: 0.25, seed: 1083 },
  { label: 'I4', staffCount: 18, distribution: [4,6,8],   perNight: 3, bunkRestriction: true,  totalNights: 20, heavyCount: 2, flexiblePercent: 0.25, seed: 1084 },
  { label: 'I5', staffCount: 12, distribution: [2,4,6],   perNight: 3, bunkRestriction: true,  totalNights: 15, heavyCount: 2, flexiblePercent: 0.25, seed: 1085 },
  { label: 'I6', staffCount: 23, distribution: [5,6,6,6], perNight: 4, bunkRestriction: true,  totalNights: 27, heavyCount: 4, flexiblePercent: 0.10, seed: 1086 },
];

// ─── Main ─────────────────────────────────────────────────────────────────────

const RUNS_PER_SCENARIO = 500;

process.stdout.write(
  `\nStress-testing scheduler: ${scenarios.length} scenarios, ${RUNS_PER_SCENARIO} runs each\n\n`
);

const results: ScenarioResult[] = scenarios.map((s, i) => {
  process.stdout.write(`  [${String(i + 1).padStart(2)}/${scenarios.length}] ${s.label.padEnd(4)}`);
  const result = runScenario(s, RUNS_PER_SCENARIO);
  const flagStr = result.flags.length > 0 ? ` ⚠  ${result.flags.join(', ')}` : '';
  process.stdout.write(` done${flagStr}\n`);
  return result;
});

// Sort worst → best by how much weighted spread exceeds the achievable floor.
results.sort((a, b) => {
  const aExcess = a.weightedSpread - a.achievableFloor;
  const bExcess = b.weightedSpread - b.achievableFloor;
  return bExcess - aExcess;
});

// ─── Print summary table ──────────────────────────────────────────────────────

function col(s: string | number, w: number, right = false): string {
  const str = String(s);
  return right ? str.padStart(w) : str.padEnd(w);
}

const LINE = '─'.repeat(128);

console.log(`\n${LINE}`);
console.log(
  col('Lbl', 4) +
  col('Staff/Dist/N', 26) +
  col('Nights/Hvy/Flex', 18) +
  col('Rst', 4) +
  col('N/nt', 5) +
  col('WtSprd', 7) +
  col('Floor', 7) +
  col('% Flr', 7) +
  col('RwSpd', 6) +
  col('HvySpd', 7) +
  col('FlxCrss', 8) +
  'Status'
);
console.log(LINE);

for (const r of results) {
  if (r.error) {
    console.log(
      col(r.label, 4) +
      col(`${r.staffCount}:[${r.distribution.join(',')}]`, 26) +
      col(`${r.totalNights}N/${r.heavyCount}H/${Math.round(r.flexiblePercent * 100)}%`, 18) +
      col(r.bunkRestriction ? 'Y' : 'N', 4) +
      col(r.perNight, 5) +
      col('ERROR', 42) +
      r.error
    );
    continue;
  }

  const pct = r.achievableFloor > 0
    ? `${Math.round((r.weightedSpread / r.achievableFloor) * 100)}%`
    : 'n/a';
  const flagStr = r.flags.length > 0 ? `⚠  ${r.flags.join(', ')}` : 'ok';

  console.log(
    col(r.label, 4) +
    col(`${r.staffCount}:[${r.distribution.join(',')}]`, 26) +
    col(`${r.totalNights}N/${r.heavyCount}H/${Math.round(r.flexiblePercent * 100)}%`, 18) +
    col(r.bunkRestriction ? 'Y' : 'N', 4) +
    col(r.perNight, 5) +
    col(r.weightedSpread.toFixed(2), 7, true) +
    col(r.achievableFloor.toFixed(2), 7, true) +
    col(pct, 7, true) +
    col(r.rawSpread, 6, true) +
    col(r.heavySpread, 7, true) +
    col(r.flexiblePercent > 0 ? r.flexCrossBunk : '-', 8, true) +
    flagStr
  );
}

console.log(LINE);

// ─── Flag summary ─────────────────────────────────────────────────────────────

const flagged = results.filter((r) => r.flags.length > 0);
const byFlag: Record<string, string[]> = {};
for (const r of flagged) {
  for (const f of r.flags) {
    (byFlag[f] ??= []).push(r.label);
  }
}

console.log(`\nFlagged: ${flagged.length}/${results.length} scenarios`);
for (const [flag, labels] of Object.entries(byFlag)) {
  console.log(`  [${flag}] ${labels.join(', ')}`);
}
console.log();
