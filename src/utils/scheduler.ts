import type {
  NightTypeConfig,
  NightTypeId,
  ScheduleConfig,
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

/** Extracts the trailing number from a bunk string. "M1" → 1, "O12" → 12, "Unknown" → 0. */
export function getBunkNumber(bunk: string): number {
  const match = bunk.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

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

function safeVariance(arr: number[]): number {
  if (arr.length <= 1) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length;
}

interface RunResult {
  schedule: GeneratedSchedule;
  pairings: Record<string, Record<string, number>>;
}

interface ValidationResult {
  passed: boolean;
  hardFail: boolean;
  messages: string[];
}

/**
 * Filters pool down to whoever has the fewest assignments of this specific night type
 * so far. Only applied to SCARCE night types (closedMeeting, openHeavy) where there are
 * few enough occurrences that random clustering on one person is a real risk. For common
 * types (open, closed) the load-based sort already accounts for total burden correctly,
 * and narrowing the pool by raw type-count first can override a better load-based pick
 * — e.g. forcing someone with low "open" count but already-high overall load to the front.
 */
function applyTypeSpreadFilter(
  pool: Staff[],
  typeId: NightTypeId,
  byType: Record<string, Record<NightTypeId, number>>,
  minPoolSizeNeeded: number
): Staff[] {
  if (typeId !== 'closedMeeting' && typeId !== 'openHeavy') return pool;
  const minOfType = Math.min(...pool.map((s) => byType[s.id][typeId]));
  const typeFiltered = pool.filter((s) => byType[s.id][typeId] === minOfType);
  return typeFiltered.length >= minPoolSizeNeeded ? typeFiltered : pool;
}

/**
 * Finds the index of the best candidate in pool[], using weighted load → rawCount →
 * average pairings with already-selected staff as successive tiebreakers.
 */
function bestCandidateIdx(
  pool: Staff[],
  alreadySelected: Staff[],
  load: Record<string, number>,
  rawCount: Record<string, number>,
  pairings: Record<string, Record<string, number>>
): number {
  let bestIdx = 0;
  for (let i = 1; i < pool.length; i++) {
    const curr = pool[bestIdx];
    const cand = pool[i];

    const wDiff = load[curr.id] - load[cand.id];
    if (Math.abs(wDiff) > 0.001) {
      if (wDiff > 0) bestIdx = i;
      continue;
    }

    const cDiff = rawCount[curr.id] - rawCount[cand.id];
    if (cDiff !== 0) {
      if (cDiff > 0) bestIdx = i;
      continue;
    }

    if (alreadySelected.length > 0) {
      const avgCurr =
        alreadySelected.reduce((sum, sel) => sum + pairings[curr.id][sel.id], 0) /
        alreadySelected.length;
      const avgCand =
        alreadySelected.reduce((sum, sel) => sum + pairings[cand.id][sel.id], 0) /
        alreadySelected.length;
      if (avgCand < avgCurr) bestIdx = i;
    }
  }
  return bestIdx;
}

function runOnce(config: ScheduleConfig, seed: number): RunResult | null {
  const { staff, nights, perNight, bunkRestriction } = config;
  const rng = makePrng(seed);

  // Single load accumulator = nightType.weight per night assigned.
  const load: Record<string, number> = {};
  const rawCount: Record<string, number> = {};
  const byType: Record<string, Record<NightTypeId, number>> = {};
  const pairings: Record<string, Record<string, number>> = {};

  for (const s of staff) {
    load[s.id] = 0;
    rawCount[s.id] = 0;
    byType[s.id] = { closedMeeting: 0, closed: 0, open: 0, openHeavy: 0 };
    pairings[s.id] = {};
    for (const t of staff) pairings[s.id][t.id] = 0;
  }

  const assignments: { night: (typeof nights)[number]; assigned: Staff[] }[] = [];

  for (const night of nights) {
    const nightType = NIGHT_TYPE_MAP[night.typeId];

    // allStaffOnDuty nights (e.g. arrival day): assign everyone, skip all load accounting.
    if (night.allStaffOnDuty) {
      assignments.push({ night, assigned: [...staff] });
      continue;
    }

    // Block anyone assigned in the previous 2 non-allStaff nights (no-consecutive constraint)
    const prevScored = assignments.filter((a) => !a.night.allStaffOnDuty);
    const blocked = new Set<string>();
    if (prevScored.length >= 1) {
      for (const s of prevScored[prevScored.length - 1].assigned) blocked.add(s.id);
    }
    if (prevScored.length >= 2) {
      for (const s of prevScored[prevScored.length - 2].assigned) blocked.add(s.id);
    }

    const selected: Staff[] = [];

    if (bunkRestriction) {
      // Randomize slot order each night to prevent slot 1 always getting first pick
      const slotOrder = shuffleArray(
        Array.from({ length: perNight }, (_, i) => i + 1),
        rng
      );
      const slotPick: Record<number, Staff> = {};

      for (const slot of slotOrder) {
        const alreadyPicked = Object.values(slotPick);

        let pool = staff.filter((s) => getBunkNumber(s.bunk) === slot && !blocked.has(s.id));
        if (pool.length === 0) pool = staff.filter((s) => getBunkNumber(s.bunk) === slot);
        if (pool.length === 0) return null;

        // Spread THIS night type evenly within the slot's eligible pool first —
        // applies to closedMeeting/closed/open/openHeavy uniformly.
        pool = applyTypeSpreadFilter(pool, night.typeId, byType, 1);

        pool = shuffleArray(pool, rng);
        pool.sort((a, b) => {
          const wDiff = load[a.id] - load[b.id];
          if (Math.abs(wDiff) > 0.001) return wDiff;
          return rawCount[a.id] - rawCount[b.id];
        });

        const minCount = Math.min(...pool.map((s) => rawCount[s.id]));
        const slotFiltered = pool.filter((s) => rawCount[s.id] <= minCount + 1);
        const slotPool = slotFiltered.length >= 1 ? slotFiltered : pool;

        const idx = bestCandidateIdx(slotPool, alreadyPicked, load, rawCount, pairings);
        slotPick[slot] = slotPool[idx];
      }

      for (let slot = 1; slot <= perNight; slot++) {
        selected.push(slotPick[slot]);
      }
    } else {
      let candidates: Staff[] = staff.filter((s) => !blocked.has(s.id));
      if (candidates.length < perNight) candidates = [...staff];

      // Spread THIS night type evenly across the combined pool first —
      // applies to closedMeeting/closed/open/openHeavy uniformly.
      candidates = applyTypeSpreadFilter(candidates, night.typeId, byType, perNight);

      candidates = shuffleArray(candidates, rng);
      candidates.sort((a, b) => {
        const wDiff = load[a.id] - load[b.id];
        if (Math.abs(wDiff) > 0.001) return wDiff;
        return rawCount[a.id] - rawCount[b.id];
      });

      const minCount = Math.min(...candidates.map((s) => rawCount[s.id]));
      const countFiltered = candidates.filter((s) => rawCount[s.id] <= minCount + 1);
      const pool = countFiltered.length >= perNight ? countFiltered : candidates;

      const remaining = [...pool];
      while (selected.length < perNight && remaining.length > 0) {
        const idx = bestCandidateIdx(remaining, selected, load, rawCount, pairings);
        selected.push(remaining.splice(idx, 1)[0]!);
      }
    }

    if (selected.length < perNight) return null;

    for (const s of selected) {
      load[s.id] += nightType.weight;
      rawCount[s.id] += 1;
      byType[s.id][night.typeId] += 1;
    }

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
    weightedTotal: Math.round(load[s.id] * 100) / 100,
    byType: byType[s.id],
  }));

  return { schedule: { assignments, stats, seed }, pairings };
}

function validateSchedule(schedule: GeneratedSchedule, config: ScheduleConfig): ValidationResult {
  const { bunkRestriction, staff } = config;
  const messages: string[] = [];
  let hardFail = false;
  let qualityFail = false;

  // (a) Global weighted spread across all staff, compared against an ACHIEVABLE floor.
  // When bunkRestriction is on and bunk groups have unequal sizes, smaller groups will
  // always average higher per-capita load — that's a structural fact, not unfairness the
  // algorithm can fix. We estimate that unavoidable floor from group-size ratios and only
  // flag spread that exceeds it by a real margin.
  const weights = schedule.stats.map((s) => s.weightedTotal);
  const weightSpread = weights.length > 0 ? Math.max(...weights) - Math.min(...weights) : 0;

  let achievableFloor = 0.5; // baseline tolerance for any schedule
  if (bunkRestriction) {
    const groupSizes = new Map<number, number>();
    for (const s of staff) {
      const n = getBunkNumber(s.bunk);
      groupSizes.set(n, (groupSizes.get(n) ?? 0) + 1);
    }
    const sizes = Array.from(groupSizes.values());
    if (sizes.length > 1) {
      const totalWeight = schedule.stats.reduce((a, s) => a + s.weightedTotal, 0);
      const avgWeight = totalWeight / schedule.stats.length;
      const maxSize = Math.max(...sizes);
      const minSize = Math.min(...sizes);
      // Smaller group's per-person share scales up by (maxSize/minSize) relative to average.
      const structuralGap = avgWeight * (maxSize / minSize - 1);
      achievableFloor = Math.max(achievableFloor, structuralGap * 1.15); // small buffer
    }
  }

  if (weightSpread >= achievableFloor) {
    messages.push(
      `[a] FAIL: weighted spread ${weightSpread.toFixed(3)} >= achievable floor ${achievableFloor.toFixed(3)}`
    );
    qualityFail = true;
  } else {
    messages.push(
      `[a] PASS: weighted spread ${weightSpread.toFixed(3)} (floor ${achievableFloor.toFixed(3)})`
    );
  }

  // (c) No consecutive night assignments — hard fail if violated (allStaffOnDuty nights excluded)
  const scoredAssignments = schedule.assignments.filter((a) => !a.night.allStaffOnDuty);
  let consecViolated = false;
  for (let i = 1; i < scoredAssignments.length; i++) {
    const prev = scoredAssignments[i - 1];
    const curr = scoredAssignments[i];
    const prevIds = new Set(prev.assigned.map((s) => s.id));
    for (const s of curr.assigned) {
      if (prevIds.has(s.id)) {
        messages.push(
          `[c] FAIL: ${s.name} in consecutive nights "${prev.night.label}" and "${curr.night.label}"`
        );
        hardFail = true;
        consecViolated = true;
      }
    }
  }
  if (!consecViolated) messages.push('[c] PASS: no consecutive night assignments');

  // (d) Slot integrity: assigned[i] must have getBunkNumber(bunk) === i+1 — hard fail if violated
  if (bunkRestriction) {
    let slotViolated = false;
    for (const { night, assigned } of scoredAssignments) {
      for (let idx = 0; idx < assigned.length; idx++) {
        const s = assigned[idx];
        const expectedSlot = idx + 1;
        if (getBunkNumber(s.bunk) !== expectedSlot) {
          messages.push(
            `[d] FAIL: ${s.name} (bunk ${s.bunk}) in slot ${expectedSlot} on "${night.label}"`
          );
          hardFail = true;
          slotViolated = true;
        }
      }
    }
    if (!slotViolated) messages.push('[d] PASS: slot integrity');
  }

  // (e) Count balance: flag spread > 2, fail > 3
  const counts = schedule.stats.map((s) => s.total);
  const countSpread = counts.length > 0 ? Math.max(...counts) - Math.min(...counts) : 0;
  if (countSpread > 3) {
    messages.push(`[e] FAIL: raw count spread ${countSpread} > 3`);
    qualityFail = true;
  } else if (countSpread > 2) {
    messages.push(`[e] WARN: raw count spread ${countSpread} > 2`);
    qualityFail = true;
  } else {
    messages.push(`[e] PASS: raw count spread ${countSpread}`);
  }

  return { passed: !hardFail && !qualityFail, hardFail, messages };
}

// Single source of truth: minimize variance of weightedTotal across all staff.
function scoreSchedule(
  schedule: GeneratedSchedule,
  pairings: Record<string, Record<string, number>>
): number {
  const weightVariance = safeVariance(schedule.stats.map((s) => s.weightedTotal));
  const countVariance = safeVariance(schedule.stats.map((s) => s.total));

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

  return weightVariance * 4 + countVariance * 2 + pairingPenalty * 1.5;
}

export function generateSchedule(config: ScheduleConfig, runs = 800): GeneratedSchedule {
  const { staff, nights, perNight, bunkRestriction } = config;

  // DIAGNOSTIC: input shape
  const heavyNightCount = nights.filter((n) => !n.allStaffOnDuty && n.typeId === 'openHeavy').length;
  console.log(`[diag] ${nights.length} total nights, ${heavyNightCount} openHeavy`);
  if (bunkRestriction) {
    for (let slot = 1; slot <= perNight; slot++) {
      const g = staff.filter((s) => getBunkNumber(s.bunk) === slot);
      console.log(`[diag] Slot ${slot}: ${g.length} staff`);
    }
  }

  if (bunkRestriction) {
    for (let slot = 1; slot <= perNight; slot++) {
      if (!staff.some((s) => getBunkNumber(s.bunk) === slot)) {
        throw new Error(
          `No staff in bunk number ${slot}. Add staff whose bunk name ends in ${slot} ` +
          `(e.g. M${slot}, O${slot}, S${slot}), or turn off bunk restriction.`
        );
      }
    }
  }

  let cleanPasses = 0;
  let fallbackPasses = 0;
  let hardFails = 0;
  let bestQuality: { schedule: GeneratedSchedule; score: number } | null = null;
  let bestFallback: { schedule: GeneratedSchedule; score: number } | null = null;

  for (let i = 0; i < runs; i++) {
    const seed = Math.floor(Math.random() * 2 ** 32);
    const result = runOnce(config, seed);
    if (!result) continue;

    const validation = validateSchedule(result.schedule, config);
    if (validation.hardFail) {
      hardFails++;
      continue;
    }

    const score = scoreSchedule(result.schedule, result.pairings);

    if (validation.passed) {
      cleanPasses++;
      if (!bestQuality || score < bestQuality.score) {
        bestQuality = { schedule: result.schedule, score };
      }
    } else {
      fallbackPasses++;
      if (!bestFallback || score < bestFallback.score) {
        bestFallback = { schedule: result.schedule, score };
      }
    }
  }

  console.log(
    `[diag] Run summary: ${cleanPasses} clean, ${fallbackPasses} fallback, ${hardFails} hard-fail out of ${runs}`
  );

  const best = bestQuality ?? bestFallback;
  if (!best) throw new Error('Could not generate a valid schedule. Check staff count vs. nights.');

  // DIAGNOSTIC: winning run breakdown, full byType included
  console.log('[diag] Winning run (by weightedTotal desc):');
  [...best.schedule.stats]
    .sort((a, b) => b.weightedTotal - a.weightedTotal)
    .forEach((s) =>
      console.log(
        `  ${s.name} (${s.bunk}): mtg=${s.byType.closedMeeting} closed=${s.byType.closed} ` +
        `open=${s.byType.open} heavy=${s.byType.openHeavy} | ${s.total} nights, ${s.weightedTotal.toFixed(2)} wt`
      )
    );

  const finalValidation = validateSchedule(best.schedule, config);
  if (!finalValidation.passed) {
    console.warn('[scheduler] No fully valid schedule found. Best available result returned.');
  }
  console.log('[scheduler] Final validation:\n' + finalValidation.messages.join('\n'));

  return best.schedule;
}

export function exportToCSV(schedule: GeneratedSchedule, perNight: number): string {
  const headers = ['Day', 'Type', ...Array.from({ length: perNight }, (_, i) => `OD ${i + 1}`)];
  const rows = schedule.assignments.map(({ night, assigned }, idx) => {
    const dayLabel = `Day ${idx + 1}${night.label ? ` — ${night.label}` : ''}`;
    if (night.allStaffOnDuty) {
      return [dayLabel, 'All staff on duty', ...Array<string>(perNight).fill('')];
    }
    const type = NIGHT_TYPE_MAP[night.typeId].label;
    return [dayLabel, type, ...assigned.map((s) => s.name)];
  });

  const csvRows = [headers, ...rows].map((row) =>
    row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
  );
  return csvRows.join('\n');
}