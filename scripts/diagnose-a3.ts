/**
 * scripts/diagnose-a3.ts
 *
 * Diagnoses whether the A3 SPREAD flag is a search-depth artifact or a
 * greedy structural ceiling.
 *
 * Run:  npx tsx scripts/diagnose-a3.ts
 *
 * Step 1 — variance across 10 independent 500-run batches (same input data,
 *           different random seeds inside generateSchedule).  High variance →
 *           search depth matters.  Low variance → ceiling is structural.
 *
 * Step 2 — single 5000-run batch; compare best spread to the 500-run results.
 *
 * Step 3 — per-bunk breakdown of the 5000-run winner: min, max, spread of
 *           weightedTotal WITHIN each bunk, plus each staff member's full
 *           type breakdown.
 */

import { generateSchedule, getBunkNumber } from '../src/utils/scheduler';
import type { Staff, Night, ScheduleConfig, GeneratedSchedule, NightTypeId } from '../src/types';

// ─── Seeded PRNG (identical to stress-test-scheduler.ts) ─────────────────────

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

// ─── Data generators (identical to stress-test-scheduler.ts) ─────────────────

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
  while (staff.length < count) {
    staff.push({ id: `s${idx}`, name: `Staff ${idx}`, bunk: `M${bunkSizeDistribution.length}` });
    idx++;
  }
  if (staff.length > count) staff.length = count;
  const flexCount = Math.round(count * flexiblePercent);
  if (flexCount > 0) {
    const indices = shuffle(Array.from({ length: count }, (_, i) => i), rng).slice(0, flexCount);
    for (const i of indices) staff[i] = { ...staff[i], flexibleBunk: true };
  }
  return staff;
}

function makeDummyNights(
  totalNights: number,
  heavyCount: number,
  meetingCount: number,
  closedRatio: number,
  allStaff: Staff[],
  seed: number
): Night[] {
  const rng = seedRng(seed + 1000);
  const eligible = shuffle(
    Array.from({ length: Math.max(0, totalNights - 2) }, (_, i) => i + 1),
    rng
  );
  const heavyPositions = new Set(eligible.slice(0, heavyCount));
  const meetingPositions = new Set(eligible.slice(heavyCount, heavyCount + meetingCount));
  const unavailSet = new Set(
    shuffle(Array.from({ length: totalNights }, (_, i) => i), rng).slice(
      0,
      Math.max(1, Math.round(totalNights * 0.2))
    )
  );
  const nights: Night[] = [];
  for (let i = 0; i < totalNights; i++) {
    let typeId: NightTypeId;
    if (heavyPositions.has(i)) typeId = 'openHeavy';
    else if (meetingPositions.has(i)) typeId = 'closedMeeting';
    else typeId = rng() < closedRatio ? 'closed' : 'open';

    const unavailableStaffIds: string[] = [];
    if (unavailSet.has(i) && allStaff.length > 0) {
      const n = rng() < 0.5 ? 1 : 2;
      const s = shuffle(allStaff, rng);
      for (let k = 0; k < Math.min(n, s.length); k++) unavailableStaffIds.push(s[k].id);
    }
    nights.push({ id: `n${i + 1}`, label: `Night ${i + 1}`, typeId, unavailableStaffIds });
  }
  return nights;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function runQuiet(config: ScheduleConfig, runs: number): GeneratedSchedule {
  const orig = { log: console.log, warn: console.warn };
  console.log = () => {};
  console.warn = () => {};
  try {
    return generateSchedule(config, runs);
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
  }
}

function weightedSpread(s: GeneratedSchedule): number {
  const wt = s.stats.map((x) => x.weightedTotal);
  return Math.max(...wt) - Math.min(...wt);
}

function nightTypeSummary(nights: Night[]): string {
  const counts: Record<string, number> = {};
  for (const n of nights) counts[n.typeId] = (counts[n.typeId] ?? 0) + 1;
  return Object.entries(counts)
    .map(([t, c]) => `${c}×${t}`)
    .join('  ');
}

// ─── A3 scenario parameters (exactly as defined in stress-test-scheduler.ts) ──

const A3 = {
  staffCount:      23,
  distribution:    [5, 6, 6, 6],
  perNight:        4,
  bunkRestriction: true,
  totalNights:     27,
  heavyCount:      2,
  flexiblePercent: 0,
  seed:            1003,
} as const;

const staff  = makeDummyStaff(A3.staffCount, [...A3.distribution], A3.flexiblePercent, A3.seed);
const nights = makeDummyNights(
  A3.totalNights, A3.heavyCount,
  Math.max(0, Math.round(A3.totalNights / 7)),  // meetingCount ≈ 4
  0.4, staff, A3.seed
);
const config: ScheduleConfig = {
  staff, nights,
  perNight:        A3.perNight,
  bunkRestriction: A3.bunkRestriction,
};

// ─── Print scenario summary ───────────────────────────────────────────────────

console.log('\n════════════════════════════════════════════════════════════════');
console.log('  DIAGNOSE A3: 23 staff [5,6,6,6], 4/night, restrict, 27 nights');
console.log('════════════════════════════════════════════════════════════════\n');

console.log('Night sequence:');
nights.forEach((n, i) => {
  const unavail = n.unavailableStaffIds?.length ? ` (unavail: ${n.unavailableStaffIds.join(',')})` : '';
  console.log(`  N${String(i + 1).padStart(2)}: ${n.typeId.padEnd(14)}${unavail}`);
});
console.log('\nType breakdown:', nightTypeSummary(nights), '\n');

// ─── Step 1: 10 independent 500-run batches ───────────────────────────────────

console.log('────────────────────────────────────────────────────────────────');
console.log('STEP 1 — variance across 10 × 500-run batches (same input data)');
console.log('────────────────────────────────────────────────────────────────');

const spreads500: number[] = [];
for (let i = 0; i < 10; i++) {
  const sched = runQuiet(config, 500);
  const sp = weightedSpread(sched);
  spreads500.push(sp);
  console.log(`  Batch ${i + 1}: weightedSpread = ${sp.toFixed(2)}`);
}

const min500 = Math.min(...spreads500);
const max500 = Math.max(...spreads500);
const avg500 = spreads500.reduce((a, b) => a + b, 0) / spreads500.length;
console.log(`\n  min=${min500.toFixed(2)}  max=${max500.toFixed(2)}  avg=${avg500.toFixed(2)}  range=${(max500 - min500).toFixed(2)}\n`);

// ─── Step 2: single 5000-run batch ───────────────────────────────────────────

console.log('────────────────────────────────────────────────────────────────');
console.log('STEP 2 — single 5000-run batch');
console.log('────────────────────────────────────────────────────────────────');
process.stdout.write('  Running 5000 attempts... ');
const sched5000 = runQuiet(config, 5000);
const sp5000 = weightedSpread(sched5000);
console.log(`done\n  weightedSpread = ${sp5000.toFixed(2)}\n`);
console.log(`  vs 500-run avg = ${avg500.toFixed(2)},  delta = ${(avg500 - sp5000).toFixed(2)}\n`);

// ─── Step 3: per-bunk breakdown of the 5000-run winner ───────────────────────

console.log('────────────────────────────────────────────────────────────────');
console.log('STEP 3 — per-bunk breakdown of 5000-run winner');
console.log('────────────────────────────────────────────────────────────────\n');

// Total night-type counts for reference
const nightTypeCounts: Record<NightTypeId, number> = {
  closedMeeting: 0, closed: 0, open: 0, openHeavy: 0,
};
for (const n of nights) nightTypeCounts[n.typeId]++;

// Theoretical average weight if assignments were perfectly even
// Each staff member would cover (27 nights × 4 slots) / 23 staff = 4.70 assignments on average
// But M1 has 5 staff and M2/M3/M4 have 6 each — all cover exactly 27 nights per bunk
// So M1 avg = 27/5 = 5.4 nights, M2-M4 avg = 27/6 = 4.5 nights

const totalAssignWeight = nights.reduce((sum, n) => {
  const w = { closedMeeting: 0.5, closed: 1.0, open: 1.5, openHeavy: 2.0 }[n.typeId];
  return sum + w * A3.perNight;
}, 0);
console.log(`  Total weight pool: ${totalAssignWeight.toFixed(1)} across all 27×4 slots`);
console.log(`  Per-staff avg: ${(totalAssignWeight / A3.staffCount).toFixed(2)}\n`);

// Per-bunk group analysis
for (let slot = 1; slot <= A3.perNight; slot++) {
  const bunkStaff = sched5000.stats
    .filter((s) => getBunkNumber(staff.find((x) => x.id === s.staffId)!.bunk) === slot)
    .sort((a, b) => b.weightedTotal - a.weightedTotal);

  if (bunkStaff.length === 0) continue;

  const wts = bunkStaff.map((s) => s.weightedTotal);
  const bunkMin = Math.min(...wts);
  const bunkMax = Math.max(...wts);
  const bunkSpread = bunkMax - bunkMin;
  const bunkAvg = wts.reduce((a, b) => a + b, 0) / wts.length;

  // Total weight this bunk MUST cover across all 27 nights
  const bunkNightWeight = nights.reduce((sum, n) => {
    const w = { closedMeeting: 0.5, closed: 1.0, open: 1.5, openHeavy: 2.0 }[n.typeId];
    return sum + w;
  }, 0);

  console.log(`  ┌── Bunk M${slot} (${bunkStaff.length} staff) ──────────────────────────────────────`);
  console.log(`  │   Bunk covers: ${bunkNightWeight.toFixed(1)} total weight across 27 nights`);
  console.log(`  │   Per-person theoretical avg: ${(bunkNightWeight / bunkStaff.length).toFixed(2)}`);
  console.log(`  │   Actual avg: ${bunkAvg.toFixed(2)}  spread: ${bunkSpread.toFixed(2)}`);
  console.log(`  │`);
  console.log(`  │   ${' Name'.padEnd(12)} ${'Nights'.padStart(6)} ${'WtTot'.padStart(6)} ${'Mtg'.padStart(4)} ${'Cls'.padStart(4)} ${'Opn'.padStart(4)} ${'Hvy'.padStart(4)}`);
  for (const s of bunkStaff) {
    const marker = s.weightedTotal === bunkMax ? ' ▲max' : s.weightedTotal === bunkMin ? ' ▼min' : '';
    console.log(
      `  │   ${s.name.padEnd(12)} ${String(s.total).padStart(6)} ${s.weightedTotal.toFixed(2).padStart(6)}` +
      ` ${String(s.byType.closedMeeting).padStart(4)} ${String(s.byType.closed).padStart(4)}` +
      ` ${String(s.byType.open).padStart(4)} ${String(s.byType.openHeavy).padStart(4)}${marker}`
    );
  }
  console.log(`  └─────────────────────────────────────────────────────────────\n`);
}

// ─── Step 4: interpretation ───────────────────────────────────────────────────

console.log('────────────────────────────────────────────────────────────────');
console.log('INTERPRETATION EVIDENCE');
console.log('────────────────────────────────────────────────────────────────');
console.log(`  500-run range:  ${min500.toFixed(2)} – ${max500.toFixed(2)}  (range ${(max500 - min500).toFixed(2)})`);
console.log(`  5000-run best:  ${sp5000.toFixed(2)}`);
console.log(`  Improvement going 500→5000: ${(avg500 - sp5000).toFixed(2)}`);
console.log();

const rangeRatio = (max500 - min500) / avg500;
const improvementRatio = (avg500 - sp5000) / avg500;

if (rangeRatio > 0.3 || improvementRatio > 0.2) {
  console.log('  → HIGH variance / meaningful improvement: evidence for SEARCH-DEPTH theory.');
  console.log('    More restarts meaningfully improve spread. The greedy selector is finding');
  console.log('    qualitatively different local optima on different seeds.');
} else {
  console.log('  → LOW variance / small improvement: evidence for GREEDY STRUCTURAL CEILING.');
  console.log('    The 500-run batches all converge to the same floor, and 5000 runs barely');
  console.log('    moves the needle. The greedy per-night selection hits a ceiling that more');
  console.log('    random restarts cannot break through. The spread is baked into the');
  console.log('    night-type weight mix and/or bunk-size asymmetry.');
}
console.log();
