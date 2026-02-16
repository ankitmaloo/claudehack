import { useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { signOut } from 'firebase/auth';
import { auth } from '@/lib/firebase';
import { useAuth } from '@/context/AuthContext';
import { useAppSelector, useAppDispatch } from '@/store';
import {
  setDashboardRuns,
  appendDashboardRuns,
  setDashboardLoading,
  setDashboardHasMore,
} from '@/store/slices/runsSlice';
import { fetchUserRuns, resetDashboardPagination } from '@/lib/firestore';
import { getCachedDashboardRuns, setCachedDashboardRuns } from '@/lib/cache';
import { cn } from '@/lib/utils';

export function DashboardPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const { user } = useAuth();
  const { dashboardRuns, dashboardLoading, dashboardHasMore } = useAppSelector((s) => s.runs);
  const hydratedRef = useRef(false);

  // Hydrate from cache on first mount
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    const cached = getCachedDashboardRuns();
    if (cached && cached.length > 0 && dashboardRuns.length === 0) {
      dispatch(setDashboardRuns(cached));
    }
  }, [dispatch, dashboardRuns.length]);

  const loadRuns = useCallback(async (loadMore = false) => {
    if (!user) return;
    dispatch(setDashboardLoading(true));

    try {
      if (!loadMore) {
        resetDashboardPagination();
      }
      const { runs, hasMore } = await fetchUserRuns(user.uid, 20, loadMore);
      if (loadMore) {
        dispatch(appendDashboardRuns(runs));
      } else {
        dispatch(setDashboardRuns(runs));
        // Update cache with fresh first page
        setCachedDashboardRuns(runs);
      }
      dispatch(setDashboardHasMore(hasMore));
    } catch (err) {
      console.error('Failed to fetch runs:', err);
      dispatch(setDashboardLoading(false));
    }
  }, [user, dispatch]);

  // Fetch from Firestore (syncs over cached data)
  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-emerald-600 bg-emerald-500/10';
      case 'executing': return 'text-blue-600 bg-blue-500/10';
      case 'error': return 'text-red-600 bg-red-500/10';
      default: return 'text-muted-foreground bg-muted/50';
    }
  };

  return (
    <div className="min-h-screen bg-background paper-texture">
      <header className="border-b border-border/50 px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1
              className="text-xl font-serif tracking-tight text-foreground cursor-pointer hover:text-foreground/80"
              onClick={() => navigate('/')}
            >
              Knowledge Work
            </h1>
            <span className="text-sm text-muted-foreground">Dashboard</span>
          </div>
          {user && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                {user.displayName || user.email}
              </span>
              <button
                onClick={() => signOut(auth)}
                className="px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-serif">Past Runs</h2>
          <button
            onClick={() => navigate('/')}
            className="px-4 py-2 text-sm font-medium text-foreground bg-foreground/5 hover:bg-foreground/10 rounded-lg transition-colors"
          >
            New Task
          </button>
        </div>

        {dashboardLoading && dashboardRuns.length === 0 && (
          <div className="flex justify-center py-16">
            <div className="h-5 w-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        )}

        {!dashboardLoading && dashboardRuns.length === 0 && (
          <div className="text-center py-16">
            <p className="text-muted-foreground text-sm">No runs yet. Start your first task!</p>
          </div>
        )}

        {dashboardRuns.length > 0 && (
          <div className="space-y-3">
            {dashboardRuns.map((run) => (
              <button
                key={run.runId}
                onClick={() => navigate(`/run/${run.runId}`)}
                className="w-full text-left p-4 rounded-lg border border-border/50 hover:border-border hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {run.task}
                    </p>
                    {run.result?.answer && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {run.result.answer.slice(0, 200)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {run.sandbox && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium rounded bg-violet-500/10 text-violet-600 dark:text-violet-400">
                        Sandbox
                      </span>
                    )}
                    {run.mode && (
                      <span className="text-xs text-muted-foreground capitalize">
                        {run.mode}
                      </span>
                    )}
                    <span className={cn(
                      "px-2 py-0.5 text-xs rounded-md capitalize",
                      statusColor(run.status)
                    )}>
                      {run.status}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(run.createdAt)}
                    </span>
                  </div>
                </div>
              </button>
            ))}

            {dashboardHasMore && (
              <div className="flex justify-center pt-4">
                <button
                  onClick={() => loadRuns(true)}
                  disabled={dashboardLoading}
                  className={cn(
                    "px-4 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors",
                    dashboardLoading && "opacity-50 cursor-not-allowed"
                  )}
                >
                  {dashboardLoading ? 'Loading...' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
