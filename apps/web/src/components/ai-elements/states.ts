/** Presentation facts only. Native authority and transport stay at the domain boundary. */
export type RunState =
  'pending' | 'running' | 'streaming' | 'complete' | 'failed' | 'cancelled' | 'unknown';
export type Availability<Action> =
  | { readonly kind: 'available'; readonly action: Action }
  | { readonly kind: 'unavailable'; readonly reason: string };
export type MeasuredProgress = {
  readonly completed: number;
  readonly total: number;
  readonly unit: string;
};
export type ResourceState<T> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly value: T }
  | { readonly kind: 'partial'; readonly value: T; readonly message: string };
export function safeSourceHref(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
