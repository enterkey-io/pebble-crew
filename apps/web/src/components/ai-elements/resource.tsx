import type { ReactNode } from 'react';
import { LoadingBar } from '../ui/loading-bar';
import type { ResourceState } from './states';
export function Resource<T>({
  value,
  empty,
  children,
}: {
  value: ResourceState<T>;
  empty: string;
  children: (value: T) => ReactNode;
}) {
  switch (value.kind) {
    case 'loading':
      return <LoadingBar active />;
    case 'empty':
      return <p className="text-sm text-muted-foreground">{empty}</p>;
    case 'failed':
      return (
        <p role="alert" className="text-sm text-destructive">
          {value.message}
        </p>
      );
    case 'ready':
      return <>{children(value.value)}</>;
    case 'partial':
      return (
        <div className="grid gap-3">
          {children(value.value)}
          <p className="text-xs text-muted-foreground">{value.message}</p>
        </div>
      );
  }
}
