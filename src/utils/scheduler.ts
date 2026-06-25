import type {
  FrozenAssignment,
  LockedOutAssignment,
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
 * Heavy nights must be distributed by heavy-count FIRST.
 *
 * This prevents someone from getting a second openHeavy before another eligible
 * person has gotten their first.
 *
 * Priority:
 * 1. Fewest openHeavy nights
 * 2. Lowest raw total nights
 */
function applyHeavyFairnessFilter(
  pool: Staff[],
  typeId: NightTypeId,
  rawCount: Record<string, number>,
  byType: Record<string, Record<NightTypeId, number>>,
  minPoolSizeNeeded: number
): Staff[] {
  if (typeId !== 'openHeavy') return pool;
  if (pool.length === 0) return pool;

  const minHeavy = Math.min(...pool.map((s) => byType[s.id].openHeavy));
  const heavyFiltered = pool.filter((s) => byType[s.id].openHeavy === minHeavy);

  if (heavyFiltered.length < minPoolSizeNeeded) {
    return pool;
  }

  const minRaw = Math.min(...heavyFiltered.map((s) => rawCount[s.id]));
  const rawFiltered = heavyFiltered.filter((s) => rawCount[s.id] === minRaw);

  return rawFiltered.length >= minPoolSizeNeeded ? rawFiltered : heavyFiltered;
}

/**
 * Spreads each specific night type across the eligible pool.
 *
 * For normal open/closed nights, this helps prevent one person from getting
 * clustered with too many of the same kind of night.
 *
 * For openHeavy, this is intentionally skipped because openHeavy already has
 * stricter fairness rules in applyHeavyFairnessFilter.
 */
function applyTypeSpreadFilter(
  pool: Staff[],
  typeId: NightTypeId,
  byType: Record<string, Record<NightTypeId, number>>,
  minPoolSizeNeeded: number
): Staff[] {
  if (pool.length === 0) return pool;
  if (typeId === 'openHeavy') return pool;

  const minOfType = Math.min(...pool.map((s) => byType[s.id][typeId]));
  const typeFiltered = pool.filter((s) => byType[s.id][typeId] === minOfType);

  return typeFiltered.length >= minPoolSizeNeeded ? typeFiltered : pool;
}

/**
 * Finds the index of the best candidate in pool[].
 *
 * For openHeavy:
 * 1. Fewest heavy nights
 * 2. Lowest raw total nights
 * 3. Lowest weighted load
 * 4. Least repeated pairings with already-selected staff
 *
 * For other night types:
 * 1. Lowest weighted load
 * 2. Lowest raw count
 * 3. Fewest of this specific night type
 * 4. Least repeated pairings with already-selected staff
 */
function bestCandidateIdx(
  pool: Staff[],
  alreadySelected: Staff[],
  load: Record<string, number>,
  rawCount: Record<string, number>,
  byType: Record<string, Record<NightTypeId, number>>,
  typeId: NightTypeId,
  pairings: Record<string, Record<string, number>>
): number {
  let bestIdx = 0;

  function pairingAvg(s: Staff): number {
    if (alreadySelected.length === 0) return 0;
    return (
      alreadySelected.reduce((sum, sel) => sum + pairings[s.id][sel.id], 0) /
      alreadySelected.length
    );
  }

  function isBetter(cand: Staff, curr: Staff): boolean {
    if (typeId === 'openHeavy') {
      const heavyDiff = byType[cand.id].openHeavy - byType[curr.id].openHeavy;
      if (heavyDiff !== 0) return heavyDiff < 0;

      const rawDiff = rawCount[cand.id] - rawCount[curr.id];
      if (rawDiff !== 0) return rawDiff < 0;

      const loadDiff = load[cand.id] - load[curr.id];
      if (Math.abs(loadDiff) > 0.001) return loadDiff < 0;

      const pairDiff = pairingAvg(cand) - pairingAvg(curr);
      if (Math.abs(pairDiff) > 0.001) return pairDiff < 0;

      return false;
    }

    const loadDiff = load[cand.id] - load[curr.id];
    if (Math.abs(loadDiff) > 0.001) return loadDiff < 0;

    const rawDiff = rawCount[cand.id] - rawCount[curr.id];
    if (rawDiff !== 0) return rawDiff < 0;

    const typeDiff = byType[cand.id][typeId] - byType[curr.id][typeId];
    if (typeDiff !== 0) return typeDiff < 0;

    const pairDiff = pairingAvg(cand) - pairingAvg(curr);
    if (Math.abs(pairDiff) > 0.001) return pairDiff < 0;

    return false;
  }

  for (let i = 1; i < pool.length; i++) {
    if (isBetter(pool[i], pool[bestIdx])) {
      bestIdx = i;
    }
  }

  return bestIdx;
}

function runOnce(config: ScheduleConfig, seed: number): RunResult | null {
  const { staff, nights, perNight, bunkRestriction } = config;
  const frozenList: FrozenAssignment[] = Array.isArray(config.frozenAssignments)
    ? config.frozenAssignments
    : [];
  const lockedOutList: LockedOutAssignment[] = Array.isArray(config.lockedOutAssignments)
    ? config.lockedOutAssignments
    : [];
  const rng = makePrng(seed);

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

  const assignments: { night: (typeof nights)[number]; assigned: Staff[]; unfillable?: boolean }[] =
    [];

  for (const night of nights) {
    const nightType = NIGHT_TYPE_MAP[night.typeId];

    // allStaffOnDuty nights, such as arrival day: assign everyone, skip all load accounting.
    if (night.allStaffOnDuty) {
      assignments.push({ night, assigned: [...staff] });
      continue;
    }

    // Block anyone assigned in the previous 2 non-allStaff nights.
    const prevScored = assignments.filter((a) => !a.night.allStaffOnDuty);
    const blocked = new Set<string>();

    if (prevScored.length >= 1) {
      for (const s of prevScored[prevScored.length - 1].assigned) blocked.add(s.id);
    }

    if (prevScored.length >= 2) {
      for (const s of prevScored[prevScored.length - 2].assigned) blocked.add(s.id);
    }

    const nightFrozen = frozenList.filter((f) => f.nightId === night.id);
    const frozenIds = new Set(nightFrozen.map((f) => f.staff.id));

    const unavailableIds = new Set(night.unavailableStaffIds ?? []);
    const lockedOutBySlot = new Map(
      lockedOutList.filter((l) => l.nightId === night.id).map((l) => [l.slotIndex, l.staffId])
    );
    let nightUnfillable = false;

    const selected: Staff[] = [];

    if (bunkRestriction) {
      // Randomize slot order each night to prevent slot 1 always getting first pick.
      const slotOrder = shuffleArray(
        Array.from({ length: perNight }, (_, i) => i + 1),
        rng
      );

      const slotPick: Record<number, Staff> = {};

      // Pre-fill frozen slots (slotIndex is 0-based; slot keys are 1-based bunk numbers).
      for (const f of nightFrozen) {
        slotPick[f.slotIndex + 1] = f.staff;
      }

      for (const slot of slotOrder) {
        if (slotPick[slot] !== undefined) continue; // frozen — skip selection

        const alreadyPicked = Object.values(slotPick);
        const pickedIds = new Set(alreadyPicked.map((s) => s.id));
        const slotLockedOutId = lockedOutBySlot.get(slot - 1);

        let pool = staff.filter(
          (s) =>
            getBunkNumber(s.bunk) === slot &&
            !blocked.has(s.id) &&
            !pickedIds.has(s.id) &&
            !unavailableIds.has(s.id) &&
            s.id !== slotLockedOutId
        );

        // If the no-consecutive block makes this slot impossible, relax the block.
        if (pool.length === 0) {
          pool = staff.filter(
            (s) =>
              getBunkNumber(s.bunk) === slot &&
              !pickedIds.has(s.id) &&
              !unavailableIds.has(s.id) &&
              s.id !== slotLockedOutId
          );
        }

        // If unavailability/lockout makes this slot impossible, fill best-effort and flag it.
        if (pool.length === 0) {
          pool = staff.filter((s) => getBunkNumber(s.bunk) === slot && !pickedIds.has(s.id));
          if (pool.length > 0) nightUnfillable = true;
        }

        if (pool.length === 0) return null;

        // Heavy nights: fewest heavy nights first, then lowest raw total.
        pool = applyHeavyFairnessFilter(pool, night.typeId, rawCount, byType, 1);

        // Other night types: spread specific type count.
        pool = applyTypeSpreadFilter(pool, night.typeId, byType, 1);

        pool = shuffleArray(pool, rng);

        pool.sort((a, b) => {
          if (night.typeId === 'openHeavy') {
            const heavyDiff = byType[a.id].openHeavy - byType[b.id].openHeavy;
            if (heavyDiff !== 0) return heavyDiff;

            const rawDiff = rawCount[a.id] - rawCount[b.id];
            if (rawDiff !== 0) return rawDiff;
          }

          const wDiff = load[a.id] - load[b.id];
          if (Math.abs(wDiff) > 0.001) return wDiff;

          const countDiff = rawCount[a.id] - rawCount[b.id];
          if (countDiff !== 0) return countDiff;

          return byType[a.id][night.typeId] - byType[b.id][night.typeId];
        });

        const minCount = Math.min(...pool.map((s) => rawCount[s.id]));
        const slotFiltered =
          night.typeId === 'openHeavy'
            ? pool
            : pool.filter((s) => rawCount[s.id] <= minCount + 1);

        const slotPool = slotFiltered.length >= 1 ? slotFiltered : pool;

        const idx = bestCandidateIdx(
          slotPool,
          alreadyPicked,
          load,
          rawCount,
          byType,
          night.typeId,
          pairings
        );

        slotPick[slot] = slotPool[idx];
      }

      for (let slot = 1; slot <= perNight; slot++) {
        selected.push(slotPick[slot]);
      }
    } else {
      // Pre-populate frozen positions; null slots will be filled by selection.
      const selectedArr: (Staff | null)[] = Array(perNight).fill(null);
      for (const f of nightFrozen) {
        if (f.slotIndex < perNight) selectedArr[f.slotIndex] = f.staff;
      }
      const prefilled = selectedArr.filter(Boolean) as Staff[];
      const unfrozenCount = perNight - prefilled.length;

      if (unfrozenCount > 0) {
        let candidates: Staff[] = staff.filter(
          (s) => !blocked.has(s.id) && !frozenIds.has(s.id) && !unavailableIds.has(s.id)
        );

        // If the no-consecutive block makes the night impossible, relax the block.
        if (candidates.length < unfrozenCount) {
          candidates = staff.filter((s) => !frozenIds.has(s.id) && !unavailableIds.has(s.id));
        }

        // If unavailability still makes the night impossible, fill best-effort and flag it.
        if (candidates.length < unfrozenCount) {
          candidates = staff.filter((s) => !frozenIds.has(s.id));
          if (candidates.length >= unfrozenCount) nightUnfillable = true;
        }

        // Heavy nights: fewest heavy nights first, then lowest raw total.
        candidates = applyHeavyFairnessFilter(
          candidates,
          night.typeId,
          rawCount,
          byType,
          unfrozenCount
        );

        // Other night types: spread specific type count.
        candidates = applyTypeSpreadFilter(candidates, night.typeId, byType, unfrozenCount);

        candidates = shuffleArray(candidates, rng);

        candidates.sort((a, b) => {
          if (night.typeId === 'openHeavy') {
            const heavyDiff = byType[a.id].openHeavy - byType[b.id].openHeavy;
            if (heavyDiff !== 0) return heavyDiff;

            const rawDiff = rawCount[a.id] - rawCount[b.id];
            if (rawDiff !== 0) return rawDiff;
          }

          const wDiff = load[a.id] - load[b.id];
          if (Math.abs(wDiff) > 0.001) return wDiff;

          const countDiff = rawCount[a.id] - rawCount[b.id];
          if (countDiff !== 0) return countDiff;

          return byType[a.id][night.typeId] - byType[b.id][night.typeId];
        });

        const minCount = Math.min(...candidates.map((s) => rawCount[s.id]));
        const countFiltered =
          night.typeId === 'openHeavy'
            ? candidates
            : candidates.filter((s) => rawCount[s.id] <= minCount + 1);

        const pool = countFiltered.length >= unfrozenCount ? countFiltered : candidates;
        const remaining = [...pool];
        const currentSelected = [...prefilled];

        for (let i = 0; i < perNight && remaining.length > 0; i++) {
          if (selectedArr[i] !== null) continue;

          const slotLockedOutId = lockedOutBySlot.get(i);
          let slotPool = remaining;

          if (slotLockedOutId !== undefined) {
            const filtered = remaining.filter((s) => s.id !== slotLockedOutId);
            if (filtered.length > 0) {
              slotPool = filtered;
            } else {
              nightUnfillable = true;
            }
          }

          const idx = bestCandidateIdx(
            slotPool,
            currentSelected,
            load,
            rawCount,
            byType,
            night.typeId,
            pairings
          );
          const pick = slotPool[idx];
          const remIdx = remaining.findIndex((s) => s.id === pick.id);
          remaining.splice(remIdx, 1);
          selectedArr[i] = pick;
          currentSelected.push(pick);
        }
      }

      for (const s of selectedArr) {
        if (s !== null) selected.push(s);
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

    assignments.push({ night, assigned: selected, unfillable: nightUnfillable });
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
  const frozenList: FrozenAssignment[] = Array.isArray(config.frozenAssignments)
    ? config.frozenAssignments
    : [];
  const messages: string[] = [];
  let hardFail = false;
  let qualityFail = false;

  // (a) Global weighted spread across all staff, compared against an achievable floor.
  const weights = schedule.stats.map((s) => s.weightedTotal);
  const weightSpread = weights.length > 0 ? Math.max(...weights) - Math.min(...weights) : 0;

  let achievableFloor = 0.5;

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

      const structuralGap = avgWeight * (maxSize / minSize - 1);
      achievableFloor = Math.max(achievableFloor, structuralGap * 1.15);
    }
  }

  if (weightSpread > achievableFloor) {
    messages.push(
      `[a] FAIL: weighted spread ${weightSpread.toFixed(3)} > achievable floor ${achievableFloor.toFixed(3)}`
    );
    qualityFail = true;
  } else {
    messages.push(
      `[a] PASS: weighted spread ${weightSpread.toFixed(3)} (floor ${achievableFloor.toFixed(3)})`
    );
  }

  // (b) Heavy-night fairness: no 2-vs-0 style outcomes.
  const heavyCounts = schedule.stats.map((s) => s.byType.openHeavy);
  const heavySpread =
    heavyCounts.length > 0 ? Math.max(...heavyCounts) - Math.min(...heavyCounts) : 0;

  if (heavySpread > 1) {
    messages.push(`[b] FAIL: openHeavy spread ${heavySpread} > 1`);
    qualityFail = true;
  } else {
    messages.push(`[b] PASS: openHeavy spread ${heavySpread}`);
  }

  // (c) If heavy counts are tied/balanced, heavy should lean toward lower raw totals.
  const heavyPeople = schedule.stats.filter((s) => s.byType.openHeavy > 0);
  const noHeavyPeople = schedule.stats.filter((s) => s.byType.openHeavy === 0);

  if (heavyPeople.length > 0 && noHeavyPeople.length > 0) {
    const maxHeavyRaw = Math.max(...heavyPeople.map((s) => s.total));
    const minNoHeavyRaw = Math.min(...noHeavyPeople.map((s) => s.total));

    if (maxHeavyRaw > minNoHeavyRaw + 1) {
      messages.push(
        `[b2] WARN: someone with a heavy night has ${maxHeavyRaw} total nights while someone with no heavy nights has ${minNoHeavyRaw}`
      );
      qualityFail = true;
    } else {
      messages.push('[b2] PASS: heavy nights are on the lower/fair end of raw totals');
    }
  } else {
    messages.push('[b2] PASS: heavy raw-total check not needed');
  }

  // (d) No consecutive night assignments — hard fail if violated.
  const scoredAssignments = schedule.assignments.filter((a) => !a.night.allStaffOnDuty);
  let consecViolated = false;

  for (let i = 1; i < scoredAssignments.length; i++) {
    const prev = scoredAssignments[i - 1];
    const curr = scoredAssignments[i];
    const prevIds = new Set(prev.assigned.map((s) => s.id));

    for (const s of curr.assigned) {
      if (prevIds.has(s.id)) {
        // Frozen staff may legitimately appear on consecutive nights.
        const isFrozen = frozenList.some(
          (f) => f.nightId === curr.night.id && f.staff.id === s.id
        );
        if (isFrozen) continue;
        messages.push(
          `[d] FAIL: ${s.name} in consecutive nights "${prev.night.label}" and "${curr.night.label}"`
        );
        hardFail = true;
        consecViolated = true;
      }
    }
  }

  if (!consecViolated) {
    messages.push('[d] PASS: no consecutive night assignments');
  }

  // (e) Slot integrity: assigned[i] must have getBunkNumber(bunk) === i + 1.
  if (bunkRestriction) {
    let slotViolated = false;

    for (const { night, assigned } of scoredAssignments) {
      for (let idx = 0; idx < assigned.length; idx++) {
        const s = assigned[idx];
        const expectedSlot = idx + 1;

        if (getBunkNumber(s.bunk) !== expectedSlot) {
          messages.push(
            `[e] FAIL: ${s.name} (bunk ${s.bunk}) in slot ${expectedSlot} on "${night.label}"`
          );
          hardFail = true;
          slotViolated = true;
        }
      }
    }

    if (!slotViolated) {
      messages.push('[e] PASS: slot integrity');
    }
  }

  // (f) Count balance: flag spread > 2, fail > 3.
  const counts = schedule.stats.map((s) => s.total);
  const countSpread = counts.length > 0 ? Math.max(...counts) - Math.min(...counts) : 0;

  if (countSpread > 3) {
    messages.push(`[f] FAIL: raw count spread ${countSpread} > 3`);
    qualityFail = true;
  } else if (countSpread > 2) {
    messages.push(`[f] WARN: raw count spread ${countSpread} > 2`);
    qualityFail = true;
  } else {
    messages.push(`[f] PASS: raw count spread ${countSpread}`);
  }

  // (g) Type balance: open and closed should be spread as evenly as possible.
  for (const typeId of ['closed', 'open'] as NightTypeId[]) {
    const typeCounts = schedule.stats.map((s) => s.byType[typeId]);
    const spread =
      typeCounts.length > 0 ? Math.max(...typeCounts) - Math.min(...typeCounts) : 0;

    const label = NIGHT_TYPE_MAP[typeId].label;

    if (spread > 2) {
      messages.push(`[g] WARN: ${label} spread ${spread} > 2`);
      qualityFail = true;
    } else {
      messages.push(`[g] PASS: ${label} spread ${spread}`);
    }
  }

  return { passed: !hardFail && !qualityFail, hardFail, messages };
}

function scoreSchedule(
  schedule: GeneratedSchedule,
  pairings: Record<string, Record<string, number>>
): number {
  const weightVariance = safeVariance(schedule.stats.map((s) => s.weightedTotal));
  const countVariance = safeVariance(schedule.stats.map((s) => s.total));

  const openVariance = safeVariance(schedule.stats.map((s) => s.byType.open));
  const closedVariance = safeVariance(schedule.stats.map((s) => s.byType.closed));
  const heavyVariance = safeVariance(schedule.stats.map((s) => s.byType.openHeavy));

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

  // Massive penalty for 2-vs-0 heavy outcomes.
  const heavyCounts = schedule.stats.map((s) => s.byType.openHeavy);
  const heavySpread =
    heavyCounts.length > 0 ? Math.max(...heavyCounts) - Math.min(...heavyCounts) : 0;

  const heavySpreadPenalty = heavySpread > 1 ? (heavySpread - 1) ** 2 : 0;

  // Smaller penalty when heavy nights land on people with clearly higher raw counts.
  let heavyRawPenalty = 0;
  const heavyPeople = schedule.stats.filter((s) => s.byType.openHeavy > 0);
  const noHeavyPeople = schedule.stats.filter((s) => s.byType.openHeavy === 0);

  for (const heavy of heavyPeople) {
    for (const noHeavy of noHeavyPeople) {
      if (heavy.total > noHeavy.total + 1) {
        heavyRawPenalty += (heavy.total - noHeavy.total - 1) ** 2;
      }
    }
  }

  return (
    weightVariance * 4 +
    countVariance * 3 +
    openVariance * 1.5 +
    closedVariance * 1.25 +
    heavyVariance * 8 +
    heavySpreadPenalty * 100 +
    heavyRawPenalty * 8 +
    pairingPenalty * 1.5
  );
}

export function generateSchedule(config: ScheduleConfig, runs = 1200): GeneratedSchedule {
  const { staff, nights, perNight, bunkRestriction } = config;

  const heavyNightCount = nights.filter(
    (n) => !n.allStaffOnDuty && n.typeId === 'openHeavy'
  ).length;

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

  if (!best) {
    throw new Error('Could not generate a valid schedule. Check staff count vs. nights.');
  }

  console.log('[diag] Winning run (by weightedTotal desc):');

  [...best.schedule.stats]
    .sort((a, b) => b.weightedTotal - a.weightedTotal)
    .forEach((s) =>
      console.log(
        `  ${s.name} (${s.bunk}): mtg=${s.byType.closedMeeting} closed=${s.byType.closed} ` +
          `open=${s.byType.open} heavy=${s.byType.openHeavy} | ${s.total} nights, ${s.weightedTotal.toFixed(
            2
          )} wt`
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