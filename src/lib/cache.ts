/**
 * localStorage cache layer.
 * Stores auth user, dashboard runs, and individual run data
 * for instant hydration before Firestore responds.
 */

import type { AuthUser } from '@/store/slices/authSlice';
import type { DashboardRun, RunData } from '@/store/slices/runsSlice';

const KEYS = {
  AUTH_USER: 'kwh:auth_user',
  DASHBOARD_RUNS: 'kwh:dashboard_runs',
  RUN_PREFIX: 'kwh:run:',
  LAST_SYNC: 'kwh:last_sync',
} as const;


// --- Helpers ---

function get<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function set(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full — evict oldest cached runs
    evictOldRuns();
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Still full, give up silently
    }
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

function evictOldRuns() {
  const runKeys: { key: string; time: number }[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEYS.RUN_PREFIX)) {
      try {
        const run = JSON.parse(localStorage.getItem(key)!) as RunData;
        runKeys.push({ key, time: new Date(run.updatedAt).getTime() });
      } catch {
        runKeys.push({ key, time: 0 });
      }
    }
  }
  // Sort oldest first, remove half
  runKeys.sort((a, b) => a.time - b.time);
  const toRemove = Math.max(Math.floor(runKeys.length / 2), 5);
  for (let i = 0; i < toRemove && i < runKeys.length; i++) {
    localStorage.removeItem(runKeys[i].key);
  }
}

// --- Auth ---

export function getCachedUser(): AuthUser | null {
  return get<AuthUser>(KEYS.AUTH_USER);
}

export function setCachedUser(user: AuthUser | null) {
  if (user) {
    set(KEYS.AUTH_USER, user);
  } else {
    remove(KEYS.AUTH_USER);
  }
}

// --- Dashboard runs ---

export function getCachedDashboardRuns(): DashboardRun[] | null {
  return get<DashboardRun[]>(KEYS.DASHBOARD_RUNS);
}

export function setCachedDashboardRuns(runs: DashboardRun[]) {
  set(KEYS.DASHBOARD_RUNS, runs);
}

// --- Individual runs ---

export function getCachedRun(runId: string): RunData | null {
  return get<RunData>(KEYS.RUN_PREFIX + runId);
}

export function setCachedRun(run: RunData) {
  set(KEYS.RUN_PREFIX + run.runId, run);
}

// --- Bulk: cache runs from dashboard fetch ---

export function cacheDashboardRunDocs(runs: DashboardRun[]) {
  // Only cache the dashboard list, not full run data (those are fetched on demand)
  setCachedDashboardRuns(runs);
}

// --- Clear on sign out ---

export function clearCache() {
  remove(KEYS.AUTH_USER);
  remove(KEYS.DASHBOARD_RUNS);
  remove(KEYS.LAST_SYNC);
  // Remove all cached runs
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(KEYS.RUN_PREFIX)) {
      toRemove.push(key);
    }
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}
