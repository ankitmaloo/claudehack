import { createSlice, type PayloadAction } from '@reduxjs/toolkit';
import type { SSEEvent, TaskResult, BranchMetadata, BranchRef } from '@/types';

export interface RunVersion {
  versionId: string;
  events: SSEEvent[];
  result: TaskResult | null;
  status: 'executing' | 'completed' | 'error';
  error?: string;
  createdAt: string;
}

export interface RunData {
  runId: string;
  task: string;
  events: SSEEvent[];
  result: TaskResult | null;
  status: 'idle' | 'planning' | 'executing' | 'completed' | 'error';
  error?: string;
  rubric?: string;
  mode?: string;
  provider?: string;
  plan?: {
    task: string;
    brief: string;
    plan: string;
    rubric: string;
  };
  primaryVersionId: string | null;
  linkedVersions: string[];
  versions: Record<string, RunVersion>;
  branchMetadata?: BranchMetadata;
  branches: BranchRef[];
  createdAt: string;
  updatedAt: string;
  userId?: string;
}

export interface DashboardRun {
  runId: string;
  task: string;
  status: string;
  mode?: string;
  provider?: string;
  createdAt: string;
  updatedAt: string;
  result: TaskResult | null;
}

interface RunsState {
  runs: Record<string, RunData>;
  currentRunId: string | null;
  currentVersionId: string | null;
  dashboardRuns: DashboardRun[];
  dashboardLoading: boolean;
  dashboardHasMore: boolean;
}

const initialState: RunsState = {
  runs: {},
  currentRunId: null,
  currentVersionId: null,
  dashboardRuns: [],
  dashboardLoading: false,
  dashboardHasMore: true,
};

const runsSlice = createSlice({
  name: 'runs',
  initialState,
  reducers: {
    createRun(state, action: PayloadAction<{ runId: string; task: string; mode?: string; provider?: string; userId?: string }>) {
      const { runId, task, mode, provider, userId } = action.payload;
      const now = new Date().toISOString();
      state.runs[runId] = {
        runId,
        task,
        events: [],
        result: null,
        status: 'executing',
        mode,
        provider,
        primaryVersionId: null,
        linkedVersions: [],
        versions: {},
        branches: [],
        createdAt: now,
        updatedAt: now,
        userId,
      };
    },

    updateRun(state, action: PayloadAction<{ runId: string; updates: Partial<RunData> }>) {
      const { runId, updates } = action.payload;
      const existing = state.runs[runId];
      if (existing) {
        Object.assign(existing, updates);
        existing.updatedAt = new Date().toISOString();
      }
    },

    addEvents(state, action: PayloadAction<{ runId: string; events: SSEEvent[]; versionId?: string }>) {
      const { runId, events, versionId } = action.payload;
      const run = state.runs[runId];
      if (!run) return;

      if (versionId) {
        const version = run.versions[versionId];
        if (version) {
          version.events = [...version.events, ...events];
        }
      } else {
        run.events = [...run.events, ...events];
      }
      run.updatedAt = new Date().toISOString();
    },

    setResult(state, action: PayloadAction<{ runId: string; result: TaskResult; versionId?: string }>) {
      const { runId, result, versionId } = action.payload;
      const run = state.runs[runId];
      if (!run) return;

      if (versionId) {
        const version = run.versions[versionId];
        if (version) {
          version.result = result;
          version.status = 'completed';
        }
      } else {
        run.result = result;
        run.status = 'completed';
      }
      run.updatedAt = new Date().toISOString();
    },

    updateRunStatus(state, action: PayloadAction<{ runId: string; status: RunData['status']; error?: string; versionId?: string }>) {
      const { runId, status, error, versionId } = action.payload;
      const run = state.runs[runId];
      if (!run) return;

      if (versionId) {
        const version = run.versions[versionId];
        if (version) {
          version.status = status as RunVersion['status'];
          if (error) version.error = error;
        }
      } else {
        run.status = status;
        if (error) run.error = error;
      }
      run.updatedAt = new Date().toISOString();
    },

    setCurrentRun(state, action: PayloadAction<{ runId: string | null; versionId?: string | null }>) {
      state.currentRunId = action.payload.runId;
      state.currentVersionId = action.payload.versionId ?? null;
    },

    createVersion(state, action: PayloadAction<{ runId: string; versionId: string }>) {
      const { runId, versionId } = action.payload;
      const run = state.runs[runId];
      if (!run) return;

      run.versions[versionId] = {
        versionId,
        events: [],
        result: null,
        status: 'executing',
        createdAt: new Date().toISOString(),
      };
    },

    updateVersion(state, action: PayloadAction<{ runId: string; versionId: string; updates: Partial<RunVersion> }>) {
      const { runId, versionId, updates } = action.payload;
      const run = state.runs[runId];
      if (!run) return;

      const version = run.versions[versionId];
      if (version) {
        Object.assign(version, updates);
      }
    },

    setPrimaryVersion(state, action: PayloadAction<{ runId: string; versionId: string | null }>) {
      const { runId, versionId } = action.payload;
      const run = state.runs[runId];
      if (run) {
        run.primaryVersionId = versionId;
      }
    },

    addLinkedVersion(state, action: PayloadAction<{ runId: string; linkedRunId: string }>) {
      const { runId, linkedRunId } = action.payload;
      const run = state.runs[runId];
      if (run && !run.linkedVersions.includes(linkedRunId)) {
        run.linkedVersions.push(linkedRunId);
      }
    },

    addBranch(state, action: PayloadAction<{ runId: string; branch: BranchRef }>) {
      const { runId, branch } = action.payload;
      const run = state.runs[runId];
      if (run) {
        if (!run.branches) run.branches = [];
        if (!run.branches.some(b => b.runId === branch.runId)) {
          run.branches.push(branch);
        }
        run.updatedAt = new Date().toISOString();
      }
    },

    setRunFromFirestore(state, action: PayloadAction<RunData>) {
      const run = action.payload;
      state.runs[run.runId] = run;
    },

    // Dashboard actions
    setDashboardRuns(state, action: PayloadAction<DashboardRun[]>) {
      state.dashboardRuns = action.payload;
      state.dashboardLoading = false;
    },

    appendDashboardRuns(state, action: PayloadAction<DashboardRun[]>) {
      state.dashboardRuns = [...state.dashboardRuns, ...action.payload];
      state.dashboardLoading = false;
    },

    setDashboardLoading(state, action: PayloadAction<boolean>) {
      state.dashboardLoading = action.payload;
    },

    setDashboardHasMore(state, action: PayloadAction<boolean>) {
      state.dashboardHasMore = action.payload;
    },
  },
});

export const {
  createRun,
  updateRun,
  addEvents,
  setResult,
  updateRunStatus,
  setCurrentRun,
  createVersion,
  updateVersion,
  setPrimaryVersion,
  addLinkedVersion,
  addBranch,
  setRunFromFirestore,
  setDashboardRuns,
  appendDashboardRuns,
  setDashboardLoading,
  setDashboardHasMore,
} = runsSlice.actions;
export default runsSlice.reducer;
