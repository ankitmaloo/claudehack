import { type Middleware } from '@reduxjs/toolkit';
import type { BranchRef } from '@/types';
import {
  createRunDoc,
  saveStructuredEvents,
  saveRunResult,
  saveRunRubric,
  updateRunStatus as updateRunStatusFirestore,
  createVersionDoc,
  saveVersionResult,
  updateVersionStatus,
  updatePreferredVersion,
  linkVersionToRun,
  addBranchToParent,
} from '@/lib/firestore';
import { setCachedRun } from '@/lib/cache';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const firestoreMiddleware: Middleware = (storeApi) => (next) => (action: any) => {
  const result = next(action);

  // Only sync if user is authenticated
  const state = storeApi.getState() as { auth: { user?: { uid: string } }; runs: { runs: Record<string, unknown> } };
  const userId = state.auth.user?.uid;
  if (!userId) return result;

  const { type, payload } = action as { type: string; payload: any };

  switch (type) {
    case 'runs/createRun': {
      const { runId, task, mode, provider } = payload as {
        runId: string; task: string; mode?: string; provider?: string;
      };

      createRunDoc(runId, userId, task, { mode, provider }).catch((err) =>
        console.error('Failed to create run doc:', err)
      );
      break;
    }

    case 'runs/addEvents': {
      const { runId, events, versionId } = payload as {
        runId: string; events: import('@/types').SSEEvent[]; versionId?: string;
      };
      // Save rubric to run doc when it arrives (mid-stream)
      if (!versionId) {
        const rubricEvent = events.find((e) => e.type === 'rubric');
        if (rubricEvent && 'content' in rubricEvent) {
          saveRunRubric(runId, rubricEvent.content as string).catch((err) =>
            console.error('Failed to save rubric:', err)
          );
        }
      }
      break;
    }

    case 'runs/setResult': {
      const { runId, result: taskResult, versionId } = payload as {
        runId: string; result: { task: string; answer: string; rubric: string; run_id: string; takes?: string[]; set_level_gaps?: string | null };
        versionId?: string;
      };
      // Get all accumulated events from Redux and write structured docs
      const freshState = storeApi.getState() as any;
      const run = freshState.runs.runs[runId];
      const events = versionId
        ? run?.versions?.[versionId]?.events ?? []
        : run?.events ?? [];

      saveStructuredEvents(runId, events, taskResult, versionId).catch((err) =>
        console.error('Failed to save structured events:', err)
      );

      if (versionId) {
        saveVersionResult(runId, versionId, taskResult).catch((err) =>
          console.error('Failed to save version result:', err)
        );
      } else {
        saveRunResult(runId, taskResult).catch((err) =>
          console.error('Failed to save run result:', err)
        );
      }

      // Cache completed run to localStorage
      if (!versionId && run) {
        setCachedRun(run);
      }
      break;
    }

    case 'runs/setRunFromFirestore': {
      // Cache any run loaded from Firestore
      const run = payload as { runId: string };
      const freshState = storeApi.getState() as any;
      const runData = freshState.runs.runs[run.runId];
      if (runData) setCachedRun(runData);
      break;
    }

    case 'runs/updateRunStatus': {
      const { runId, status, error, versionId } = payload as {
        runId: string; status: string; error?: string; versionId?: string;
      };
      if (status === 'error' || status === 'completed') {
        // Write structured events on error/completed too
        const freshState = storeApi.getState() as any;
        const run = freshState.runs.runs[runId];
        const events = versionId
          ? run?.versions?.[versionId]?.events ?? []
          : run?.events ?? [];

        saveStructuredEvents(runId, events, run?.result, versionId).catch((err) =>
          console.error('Failed to save structured events:', err)
        );

        if (versionId) {
          updateVersionStatus(runId, versionId, status, error).catch((err) =>
            console.error('Failed to update version status:', err)
          );
        } else {
          updateRunStatusFirestore(runId, status, error).catch((err) =>
            console.error('Failed to update run status:', err)
          );
        }
      }
      break;
    }

    case 'runs/createVersion': {
      const { runId, versionId } = payload as { runId: string; versionId: string };

      createVersionDoc(runId, versionId).catch((err) =>
        console.error('Failed to create version doc:', err)
      );
      break;
    }

    case 'runs/setPrimaryVersion': {
      const { runId, versionId } = payload as { runId: string; versionId: string | null };
      updatePreferredVersion(runId, versionId).catch((err) =>
        console.error('Failed to update preferred version:', err)
      );
      break;
    }

    case 'runs/addLinkedVersion': {
      const { runId, linkedRunId } = payload as { runId: string; linkedRunId: string };
      linkVersionToRun(runId, linkedRunId).catch((err) =>
        console.error('Failed to link version to run:', err)
      );
      break;
    }

    case 'runs/addBranch': {
      const { runId, branch } = payload as { runId: string; branch: BranchRef };
      addBranchToParent(runId, branch).catch((err) =>
        console.error('Failed to add branch to parent:', err)
      );
      break;
    }
  }

  return result;
};
