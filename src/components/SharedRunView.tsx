import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { fetchSharedDoc } from '@/lib/firestore';
import { FinalOutput } from '@/components/FinalOutput';
import type { SSEEvent, TaskResult, ExecutionMode } from '@/types';

interface SharedData {
  runId: string;
  task: string;
  events: SSEEvent[];
  result: TaskResult;
  mode?: string;
  provider?: string;
}

export function SharedRunView() {
  const { shareId } = useParams<{ shareId: string }>();
  const [data, setData] = useState<SharedData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shareId) return;
    setLoading(true);
    fetchSharedDoc(shareId)
      .then((doc) => {
        if (doc) {
          setData(doc);
        } else {
          setError('This shared link does not exist or has been removed.');
        }
      })
      .catch(() => {
        setError('Failed to load shared content.');
      })
      .finally(() => setLoading(false));
  }, [shareId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-6 w-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center space-y-4 max-w-md px-8">
          <h2 className="text-xl font-serif font-medium text-foreground">Not Found</h2>
          <p className="text-sm text-muted-foreground">{error || 'Content not found.'}</p>
          <Link
            to="/"
            className="inline-block mt-4 px-4 py-2 text-sm font-medium text-primary hover:text-primary/80 transition-colors"
          >
            Go to Knowledge Work
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background paper-texture">
      {/* Minimal header */}
      <header className="border-b border-border/50 px-8 py-4">
        <div className="flex items-center justify-between max-w-4xl mx-auto">
          <Link to="/" className="text-xl font-serif tracking-tight text-foreground hover:text-foreground/80">
            Knowledge Work
          </Link>
          <span className="text-xs text-muted-foreground">Shared output</span>
        </div>
      </header>

      {/* Content */}
      <div className="overflow-y-auto">
        <FinalOutput
          result={data.result}
          events={data.events}
          mode={(data.mode as ExecutionMode) || 'standard'}
          showActions={false}
        />
      </div>
    </div>
  );
}
