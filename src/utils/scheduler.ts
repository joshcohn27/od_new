import type {
  NightTypeConfig,
  NightTypeId,
  ScheduleConfig,
  AssignedNight,
  Staff,
  StaffStats,
  GeneratedSchedule,
} from '../types';

export const NIGHT_TYPES: NightTypeConfig[] = [
  {
    id: 'closedMeeting',
    label: 'Closed + Staff Meeting',
    shortLabel: 'Mtg',
    weight: 0.5,
    color: 'meeting',
  },
  {
    id: 'closed',
    label: 'Closed',
    shortLabel: 'Closed',
    weight: 1.0,
    color: 'closed',
  },
  {
    id: 'open',
    label: 'Open',
    shortLabel: 'Open',
    weight: 1.5,
    color: 'open',
  },
  {
    id: 'openHeavy',
    label: 'Open (Heavy)',
    shortLabel: 'Heavy',
    weight: 2.0,
    color: 'heavy',
  },
];

export const NIGHT_TYPE_MAP: Record<NightTypeId, NightTypeConfig> = Object.fromEntries(
  NIGHT_TYPES.map((nt) => [nt.id, nt])
) as Record<NightTypeId, NightTypeConfig>;

const HEAVY_PENALTY = 1.0;

function shuffleArray<T>(arr: T[], rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Seeded PRNG (mulberry32)
function makePrng(seed: number) {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface RunResult {
  schedule: GeneratedSchedule;
  pairings: Record<string, Record<string, number>>;
}

function runOnce(config: ScheduleConfig, seed: number): RunResult | null {
  const { staff, nights, perNight } = config;
  const rng = makePrng(seed);

  // priorityLoad: used for candidate sorting; includes heavy penalty to deprioritize heavy-night assignees
  // reportedLoad: actual night weights only, no penalty — this is what the UI shows and what scoring optimizes
  const priorityLoad: Record<string, number> = {};
  const reportedLoad: Record<string, number> = {};
  const rawCount: Record<string, number> = {};
  const byType: Record<string, Record<NightTypeId, number>> = {};
  const pairings: Record<string, Record<string, number>> = {};

  for (const s of staff) {
    priorityLoad[s.id] = 0;
    reportedLoad[s.id] = 0;
    rawCount[s.id] = 0;
    byType[s.id] = { closedMeeting: 0, closed: 0, open: 0, openHeavy: 0 };
    pairings[s.id] = {};
    for (const t of staff) pairings[s.id][t.id] = 0;
  }

  const assignments: AssignedNight[] = [];

  for (const night of nights) {
    const nightType = NIGHT_TYPE_MAP[night.typeId];

    // Block anyone assigned in the previous 2 nights (no consecutive constraint)
    const blocked = new Set<string>();
    if (assignments.length >= 1) {
      for (const s of assignments[assignments.length - 1].assigned) blocked.add(s.id);
    }
    if (assignments.length >= 2) {
      for (const s of assignments[assignments.length - 2].assigned) blocked.add(s.id);
    }

    let candidates: Staff[] = staff.filter((s) => !blocked.has(s.id));

    if (candidates.length < perNight) {
      // Relax no-consecutive constraint only when there are too few candidates
      candidates = [...staff];
    }

    // Shuffle for randomness within equal-ranked groups, then sort by primary criteria
    candidates = shuffleArray(candidates, rng);
    candidates.sort((a, b) => {
      const wDiff = priorityLoad[a.id] - priorityLoad[b.id];
      if (Math.abs(wDiff) > 0.001) return wDiff;
      return rawCount[a.id] - rawCount[b.id];
    });

    // Enforce max raw count spread of 1
    const minCount = Math.min(...candidates.map((s) => rawCount[s.id]));
    const filtered = candidates.filter((s) => rawCount[s.id] <= minCount + 1);
    const pool = filtered.length >= perNight ? filtered : candidates;

    // Greedy selection: pick one at a time, using pair diversity as tiebreaker
    const selected: Staff[] = [];
    const remaining = [...pool];

    while (selected.length < perNight && remaining.length > 0) {
      let bestIdx = 0;
      for (let i = 1; i < remaining.length; i++) {
        const curr = remaining[bestIdx];
        const cand = remaining[i];

        const wDiff = priorityLoad[curr.id] - priorityLoad[cand.id];
        if (Math.abs(wDiff) > 0.001) {
          if (wDiff > 0) bestIdx = i;
          continue;
        }

        const cDiff = rawCount[curr.id] - rawCount[cand.id];
        if (cDiff !== 0) {
          if (cDiff > 0) bestIdx = i;
          continue;
        }

        // Tiebreaker: prefer whoever has fewer average pairings with already-selected staff
        if (selected.length > 0) {
          const avgCurr = selected.reduce((sum, sel) => sum + pairings[curr.id][sel.id], 0) / selected.length;
          const avgCand = selected.reduce((sum, sel) => sum + pairings[cand.id][sel.id], 0) / selected.length;
          if (avgCand < avgCurr) bestIdx = i;
        }
      }
      selected.push(remaining.splice(bestIdx, 1)[0]!);
    }

    if (selected.length < perNight) return null;

    for (const s of selected) {
      // priorityLoad gets the heavy penalty so the algorithm deprioritizes this person going forward
      priorityLoad[s.id] += nightType.weight;
      if (night.typeId === 'openHeavy') priorityLoad[s.id] += HEAVY_PENALTY;
      // reportedLoad tracks actual night weight only — no penalty — for the UI and scoring
      reportedLoad[s.id] += nightType.weight;
      rawCount[s.id] += 1;
      byType[s.id][night.typeId] += 1;
    }

    // Update pairings matrix (symmetric)
    for (let i = 0; i < selected.length; i++) {
      for (let j = i + 1; j < selected.length; j++) {
        pairings[selected[i].id][selected[j].id] += 1;
        pairings[selected[j].id][selected[i].id] += 1;
      }
    }

    assignments.push({ night, assigned: selected });
  }

  const stats: StaffStats[] = staff.map((s) => ({
    staffId: s.id,
    name: s.name,
    bunk: s.bunk,
    total: rawCount[s.id],
    weightedTotal: Math.round(reportedLoad[s.id] * 100) / 100,
    byType: byType[s.id],
  }));

  console.log(
    '[scheduler] weightedTotals:',
    Object.fromEntries(staff.map((s) => [s.name, Math.round(reportedLoad[s.id] * 100) / 100]))
  );

  return { schedule: { assignments, stats, seed }, pairings };
}

function scoreSchedule(
  schedule: GeneratedSchedule,
  pairings: Record<string, Record<string, number>>
): number {
  const weights = schedule.stats.map((s) => s.weightedTotal);
  const counts = schedule.stats.map((s) => s.total);
  const mean = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = (arr: number[]) => {
    const m = mean(arr);
    return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
  };

  // Pairings diversity penalty: sum (count - 1)^2 for each pair that worked together more than once
  let pairingPenalty = 0;
  const seen = new Set<string>();
  for (const a in pairings) {
    for (const b in pairings[a]) {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!seen.has(key)) {
        seen.add(key);
        const count = pairings[a][b];
        if (count > 1) pairingPenalty += (count - 1) ** 2;
      }
    }
  }

  return variance(weights) + variance(counts) * 2 + pairingPenalty * 1.5;
}

export function generateSchedule(config: ScheduleConfig, runs = 800): GeneratedSchedule {
  let best: GeneratedSchedule | null = null;
  let bestScore = Infinity;

  for (let i = 0; i < runs; i++) {
    const seed = Math.floor(Math.random() * 2 ** 32);
    const result = runOnce(config, seed);
    if (!result) continue;
    const score = scoreSchedule(result.schedule, result.pairings);
    if (score < bestScore) {
      bestScore = score;
      best = result.schedule;
    }
  }

  if (!best) throw new Error('Could not generate a valid schedule. Check staff count vs. nights.');
  return best;
}

export function exportToCSV(schedule: GeneratedSchedule, perNight: number): string {
  const headers = ['Night', 'Type', ...Array.from({ length: perNight }, (_, i) => `OD ${i + 1}`)];
  const rows = schedule.assignments.map(({ night, assigned }) => {
    const type = NIGHT_TYPE_MAP[night.typeId].label;
    return [night.label, type, ...assigned.map((s) => s.name)];
  });

  const csvRows = [headers, ...rows].map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  );
  return csvRows.join('\n');
}
