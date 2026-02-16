import {
  doc,
  setDoc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  arrayUnion,
  Timestamp,
  QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';
import type {
  SSEEvent,
  TaskResult,
  BranchMetadata,
  BranchRef,
  BriefStartEvent,
  BriefChunkEvent,
  BriefEvent,
  SubagentStartEvent,
  SubagentChunkEvent,
  VerificationEvent,
  AnswerEvent,
} from '@/types';
import type { RunData, DashboardRun } from '@/store/slices/runsSlice';
import type { ActivityItem } from '@/hooks/useSandboxExecution';

/** Recursively strip `undefined` values from an object (Firestore rejects them). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sanitize<T>(obj: T): T {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sanitize) as T;
  if (typeof obj === 'object' && !(obj instanceof Date)) {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (v !== undefined) clean[k] = sanitize(v);
    }
    return clean as T;
  }
  return obj;
}

// --- User document ---

export async function createUserDoc(uid: string, email: string | null, displayName: string | null) {
  const ref = doc(db, 'users', uid);
  // merge: true creates the doc if missing, or updates existing — works offline (queued)
  await setDoc(ref, {
    email,
    displayName,
    lastLoginAt: serverTimestamp(),
  }, { merge: true });
}

// --- Run documents ---

export async function createRunDoc(
  runId: string,
  userId: string,
  task: string,
  options?: { mode?: string; provider?: string; rubric?: string }
) {
  const ref = doc(db, 'runs', runId);
  await setDoc(ref, {
    userId,
    task,
    status: 'executing',
    mode: options?.mode ?? null,
    provider: options?.provider ?? null,
    rubric: options?.rubric ?? null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function updateRunStatus(runId: string, status: string, error?: string) {
  const ref = doc(db, 'runs', runId);
  await setDoc(ref, {
    status,
    ...(error !== undefined ? { error } : {}),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function saveRunResult(runId: string, result: TaskResult) {
  const ref = doc(db, 'runs', runId);
  await setDoc(ref, {
    result: sanitize(result),
    rubric: result.rubric || null,
    status: 'completed',
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

export async function saveRunRubric(runId: string, rubric: string) {
  const ref = doc(db, 'runs', runId);
  await setDoc(ref, { rubric, updatedAt: serverTimestamp() }, { merge: true });
}

// --- Structured event docs (subcollection) ---
// Written once when a run finishes. 5 named docs per run.

export async function saveStructuredEvents(
  runId: string,
  events: SSEEvent[],
  result?: TaskResult | null,
  versionId?: string,
) {
  const parentPath = versionId
    ? `runs/${runId}/versions/${versionId}/events`
    : `runs/${runId}/events`;

  // --- Extract briefs ---
  const briefMap = new Map<number, { index: number; instruction: string; content: string; angle?: string }>();
  for (const event of events) {
    if (event.type === 'brief_start') {
      const e = event as BriefStartEvent;
      briefMap.set(e.brief_index, { index: e.brief_index, instruction: e.instruction, content: '' });
    } else if (event.type === 'brief_chunk') {
      const e = event as BriefChunkEvent;
      const existing = briefMap.get(e.brief_index);
      if (existing) existing.content += e.content;
    } else if (event.type === 'brief') {
      const e = event as BriefEvent;
      const idx = e.index ?? 1;
      const existing = briefMap.get(idx);
      if (existing) {
        existing.content = e.content;
        if (e.angle) existing.angle = e.angle;
      } else {
        briefMap.set(idx, { index: idx, instruction: '', content: e.content, angle: e.angle });
      }
    }
  }

  // --- Extract subagents ---
  const subagentMap = new Map<string, { id: string; instruction: string; content: string; purpose?: string }>();
  for (const event of events) {
    if (event.type === 'subagent_start') {
      const e = event as SubagentStartEvent;
      subagentMap.set(e.subagent_id, { id: e.subagent_id, instruction: e.instruction, content: '', purpose: e.purpose ?? undefined });
    } else if (event.type === 'subagent_chunk') {
      const e = event as SubagentChunkEvent;
      const existing = subagentMap.get(e.subagent_id);
      if (existing) existing.content += e.content;
      else subagentMap.set(e.subagent_id, { id: e.subagent_id, instruction: '', content: e.content });
    }
  }

  // --- Extract verification ---
  const verifications: { attempt: number; answer: string; result: string; is_error: boolean }[] = [];
  for (const event of events) {
    if (event.type === 'verification') {
      const e = event as VerificationEvent;
      verifications.push({ attempt: e.attempt, answer: e.answer, result: e.result, is_error: e.is_error });
    }
  }

  // --- Extract thinking (thinking_chunk + model_chunk combined) ---
  let thinkingContent = '';
  for (const event of events) {
    if (event.type === 'thinking_chunk' || event.type === 'model_chunk') {
      thinkingContent += (event as { content: string }).content;
    }
  }

  // --- Extract answer ---
  // For explore mode, use result.takes array; otherwise use the answer event or result.answer
  let answerDoc: Record<string, unknown> | null = null;
  if (result?.takes && result.takes.length > 1) {
    answerDoc = {
      content: result.takes,
      ...(result.set_level_gaps ? { set_level_gaps: result.set_level_gaps } : {}),
      createdAt: serverTimestamp(),
    };
  } else {
    // Find last answer event, or fall back to result.answer
    let answerText = '';
    for (const event of events) {
      if (event.type === 'answer') answerText = (event as AnswerEvent).content;
    }
    if (!answerText && result?.answer) answerText = result.answer;
    if (answerText) {
      answerDoc = { content: answerText, createdAt: serverTimestamp() };
    }
  }

  // --- Write docs in parallel (only if data exists) ---
  const writes: Promise<void>[] = [];

  if (briefMap.size > 0) {
    writes.push(setDoc(doc(db, parentPath, 'briefs'), sanitize({
      items: Array.from(briefMap.values()).sort((a, b) => a.index - b.index),
      createdAt: serverTimestamp(),
    })));
  }

  if (subagentMap.size > 0) {
    writes.push(setDoc(doc(db, parentPath, 'subagents'), sanitize({
      items: Array.from(subagentMap.values()),
      createdAt: serverTimestamp(),
    })));
  }

  if (verifications.length > 0) {
    writes.push(setDoc(doc(db, parentPath, 'verification'), sanitize({
      items: verifications,
      createdAt: serverTimestamp(),
    })));
  }

  if (thinkingContent) {
    writes.push(setDoc(doc(db, parentPath, 'thinking'), {
      content: thinkingContent,
      createdAt: serverTimestamp(),
    }));
  }

  if (answerDoc) {
    writes.push(setDoc(doc(db, parentPath, 'answer'), answerDoc));
  }

  await Promise.all(writes);
}

// --- Version documents ---

export async function createVersionDoc(runId: string, versionId: string) {
  const ref = doc(db, 'runs', runId, 'versions', versionId);
  await setDoc(ref, {
    status: 'executing',
    createdAt: serverTimestamp(),
  }, { merge: true });
}

export async function saveVersionResult(runId: string, versionId: string, result: TaskResult) {
  const ref = doc(db, 'runs', runId, 'versions', versionId);
  await setDoc(ref, {
    result: sanitize(result),
    status: 'completed',
  }, { merge: true });
}

export async function updateVersionStatus(runId: string, versionId: string, status: string, error?: string) {
  const ref = doc(db, 'runs', runId, 'versions', versionId);
  await setDoc(ref, {
    status,
    ...(error !== undefined ? { error } : {}),
  }, { merge: true });
}

// --- Version management (linked runs approach) ---

/** Mark a run as a child version of another run (hides from dashboard). */
export async function markRunAsVersionChild(
  childRunId: string,
  parentRunId: string,
) {
  const ref = doc(db, 'runs', childRunId);
  await setDoc(ref, {
    parentRunId,
    isVersionChild: true,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/** Add a linked version to a parent run and set it as preferred. */
export async function linkVersionToRun(
  parentRunId: string,
  childRunId: string,
) {
  const ref = doc(db, 'runs', parentRunId);
  await setDoc(ref, {
    linkedVersions: arrayUnion(childRunId),
    primaryVersionId: childRunId,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// --- Branch management ---

/** Save branch metadata onto a server-created run doc. */
export async function saveBranchMetadata(branchRunId: string, branchMetadata: BranchMetadata) {
  const ref = doc(db, 'runs', branchRunId);
  await setDoc(ref, {
    branchMetadata: sanitize(branchMetadata),
    isVersionChild: true,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/** Add a branch ref to a parent run using arrayUnion. */
export async function addBranchToParent(parentRunId: string, branchRef: BranchRef) {
  const ref = doc(db, 'runs', parentRunId);
  await setDoc(ref, {
    branches: arrayUnion(sanitize(branchRef)),
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

/** Update which linked run is preferred (null = original). */
export async function updatePreferredVersion(runId: string, preferredRunId: string | null) {
  const ref = doc(db, 'runs', runId);
  await setDoc(ref, {
    primaryVersionId: preferredRunId,
    updatedAt: serverTimestamp(),
  }, { merge: true });
}

// --- Fetching ---

let lastDocSnapshot: QueryDocumentSnapshot | null = null;

export async function fetchUserRuns(
  userId: string,
  pageSize = 20,
  loadMore = false
): Promise<{ runs: DashboardRun[]; hasMore: boolean }> {
  let q = query(
    collection(db, 'runs'),
    where('userId', '==', userId),
    orderBy('createdAt', 'desc'),
    limit(pageSize + 1) // fetch one extra to detect hasMore
  );

  if (loadMore && lastDocSnapshot) {
    q = query(
      collection(db, 'runs'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      startAfter(lastDocSnapshot),
      limit(pageSize + 1)
    );
  }

  const snap = await getDocs(q);
  const docs = snap.docs;
  const hasMore = docs.length > pageSize;
  const sliced = hasMore ? docs.slice(0, pageSize) : docs;

  if (sliced.length > 0) {
    lastDocSnapshot = sliced[sliced.length - 1];
  }

  const runs: DashboardRun[] = sliced
    .filter((d) => !d.data().isVersionChild)
    .map((d) => {
      const data = d.data();
      return {
        runId: d.id,
        task: data.task,
        status: data.status,
        mode: data.mode,
        provider: data.provider,
        createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : data.createdAt,
        updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : data.updatedAt,
        result: data.result,
      };
    });

  return { runs, hasMore };
}

export function resetDashboardPagination() {
  lastDocSnapshot = null;
}

/** Reconstruct SSEEvent[] from the 5 named event docs. */
function reconstructEvents(basePath: string, snaps: {
  briefs: ReturnType<typeof getDoc> extends Promise<infer T> ? T : never;
  subagents: ReturnType<typeof getDoc> extends Promise<infer T> ? T : never;
  verification: ReturnType<typeof getDoc> extends Promise<infer T> ? T : never;
  thinking: ReturnType<typeof getDoc> extends Promise<infer T> ? T : never;
  answer: ReturnType<typeof getDoc> extends Promise<infer T> ? T : never;
}): SSEEvent[] {
  void basePath; // unused, path already resolved in snaps
  const events: SSEEvent[] = [];

  // Briefs → brief_start + brief per item
  if (snaps.briefs.exists()) {
    const items = snaps.briefs.data()!.items as Array<{ index: number; instruction: string; content: string; angle?: string }>;
    for (const item of items) {
      events.push({ type: 'brief_start', brief_index: item.index, instruction: item.instruction } as SSEEvent);
      events.push({ type: 'brief', content: item.content, index: item.index, angle: item.angle } as SSEEvent);
    }
  }

  // Subagents → subagent_start + subagent_chunk + subagent_end per item
  if (snaps.subagents.exists()) {
    const items = snaps.subagents.data()!.items as Array<{ id: string; instruction: string; content: string; purpose?: string }>;
    for (const item of items) {
      events.push({ type: 'subagent_start', subagent_id: item.id, instruction: item.instruction, purpose: item.purpose } as SSEEvent);
      if (item.content) {
        events.push({ type: 'subagent_chunk', subagent_id: item.id, content: item.content } as SSEEvent);
      }
      events.push({ type: 'subagent_end', subagent_id: item.id } as SSEEvent);
    }
  }

  // Verification → verification per item
  if (snaps.verification.exists()) {
    const items = snaps.verification.data()!.items as Array<{ attempt: number; answer: string; result: string; is_error: boolean }>;
    for (const item of items) {
      events.push({ type: 'verification', attempt: item.attempt, answer: item.answer, result: item.result, is_error: item.is_error } as SSEEvent);
    }
  }

  // Thinking → single thinking_chunk with full text
  if (snaps.thinking.exists()) {
    events.push({ type: 'thinking_chunk', content: snaps.thinking.data()!.content } as SSEEvent);
  }

  // Answer → answer event (standard mode has string, explore has array — handled by caller)
  if (snaps.answer.exists()) {
    const answerData = snaps.answer.data()!;
    if (!Array.isArray(answerData.content)) {
      events.push({ type: 'answer', content: answerData.content } as SSEEvent);
    }
    // Array content (explore takes) is read directly by fetchRunWithEvents into result.takes
  }

  return events;
}

async function fetchEventDocs(basePath: string) {
  const [briefs, subagents, verification, thinking, answer] = await Promise.all([
    getDoc(doc(db, basePath, 'briefs')),
    getDoc(doc(db, basePath, 'subagents')),
    getDoc(doc(db, basePath, 'verification')),
    getDoc(doc(db, basePath, 'thinking')),
    getDoc(doc(db, basePath, 'answer')),
  ]);
  return { briefs, subagents, verification, thinking, answer };
}

export async function fetchRunWithEvents(runId: string): Promise<RunData | null> {
  const runRef = doc(db, 'runs', runId);
  const runSnap = await getDoc(runRef);
  if (!runSnap.exists()) return null;

  const data = runSnap.data();

  // Fetch structured event docs
  const eventSnaps = await fetchEventDocs(`runs/${runId}/events`);
  const events = reconstructEvents(`runs/${runId}/events`, eventSnaps);

  // Enrich result with takes/set_level_gaps from answer doc (explore mode)
  let runResult: TaskResult | null = data.result ?? null;
  if (eventSnaps.answer.exists()) {
    const answerData = eventSnaps.answer.data()!;
    if (Array.isArray(answerData.content)) {
      runResult = {
        ...(runResult ?? { task: data.task, answer: '', rubric: data.rubric ?? '', run_id: runId }),
        takes: answerData.content as string[],
        set_level_gaps: answerData.set_level_gaps ?? null,
      };
    }
  }

  // Fetch versions
  const versionsSnap = await getDocs(collection(db, 'runs', runId, 'versions'));
  const versions: Record<string, RunData['versions'][string]> = {};

  for (const vDoc of versionsSnap.docs) {
    const vData = vDoc.data();
    const vEventSnaps = await fetchEventDocs(`runs/${runId}/versions/${vDoc.id}/events`);
    const vEvents = reconstructEvents(`runs/${runId}/versions/${vDoc.id}/events`, vEventSnaps);

    versions[vDoc.id] = {
      versionId: vDoc.id,
      events: vEvents,
      result: vData.result ?? null,
      status: vData.status,
      error: vData.error,
      createdAt: vData.createdAt instanceof Timestamp ? vData.createdAt.toDate().toISOString() : vData.createdAt,
    };
  }

  return {
    runId,
    task: data.task,
    events,
    result: runResult,
    status: data.status,
    error: data.error,
    rubric: data.rubric,
    mode: data.mode,
    provider: data.provider,
    primaryVersionId: data.primaryVersionId ?? null,
    linkedVersions: data.linkedVersions ?? [],
    versions,
    branchMetadata: data.branchMetadata ?? undefined,
    branches: data.branches ?? [],
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate().toISOString() : data.createdAt,
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate().toISOString() : data.updatedAt,
    userId: data.userId,
  };
}

// --- Sandbox run persistence ---

// Serialise ActivityItem for Firestore (Date → ISO string)
function serializeActivity(items: ActivityItem[]): Record<string, unknown>[] {
  return items.map((item) => ({
    ...item,
    timestamp: item.timestamp instanceof Date ? item.timestamp.toISOString() : item.timestamp,
  }));
}

// --- Shared document (public, no auth required to read) ---

function generateShareId(length = 10): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  for (let i = 0; i < length; i++) {
    id += chars[arr[i] % chars.length];
  }
  return id;
}

export async function createSharedDoc(
  runId: string,
  task: string,
  events: SSEEvent[],
  result: TaskResult,
  options?: { mode?: string; provider?: string }
): Promise<string> {
  const shareId = generateShareId();
  const ref = doc(db, 'shared', shareId);
  await setDoc(ref, sanitize({
    runId,
    task,
    events,
    result,
    mode: options?.mode ?? null,
    provider: options?.provider ?? null,
    createdAt: serverTimestamp(),
  }));
  return shareId;
}

export async function fetchSharedDoc(shareId: string): Promise<{
  runId: string;
  task: string;
  events: SSEEvent[];
  result: TaskResult;
  mode?: string;
  provider?: string;
} | null> {
  const ref = doc(db, 'shared', shareId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    runId: data.runId,
    task: data.task,
    events: (data.events ?? []) as SSEEvent[],
    result: data.result as TaskResult,
    mode: data.mode,
    provider: data.provider,
  };
}

export async function saveSandboxRun(
  runId: string,
  userId: string,
  task: string,
  activity: ActivityItem[],
  result: TaskResult | null,
  options?: { status?: string; error?: string; mode?: string; provider?: string; rubric?: string }
) {
  const ref = doc(db, 'runs', runId);
  await setDoc(ref, sanitize({
    userId,
    task,
    status: options?.status ?? (result ? 'completed' : 'error'),
    mode: options?.mode ?? null,
    provider: options?.provider ?? null,
    rubric: options?.rubric ?? null,
    result: result ?? null,
    error: options?.error ?? null,
    sandbox: true,
    activity: serializeActivity(activity),
    primaryVersionId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }));
}
