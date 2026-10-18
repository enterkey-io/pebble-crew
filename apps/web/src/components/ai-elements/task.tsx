import { Activity } from './activity';
import { Progress } from '../ui/progress';
import type { MeasuredProgress, RunState } from './states';
export function Task({
  title,
  state,
  progress,
  description,
}: {
  title: string;
  state: RunState;
  progress?: MeasuredProgress;
  description?: string;
}) {
  return (
    <Activity title={title} state={state}>
      {(description || progress) && (
        <div className="grid gap-3">
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
          {progress && progress.total > 0 && (
            <>
              <Progress
                aria-label={progress.unit}
                value={Math.min(100, Math.max(0, (progress.completed / progress.total) * 100))}
              />
              <p className="text-xs text-muted-foreground">
                {progress.completed} / {progress.total} {progress.unit}
              </p>
            </>
          )}
        </div>
      )}
    </Activity>
  );
}
