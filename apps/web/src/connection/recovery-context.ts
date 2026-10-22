import { createContext, useContext } from 'react';

/** Resource reducers refresh their baselines without replacing the stable client or drafts. */
export const ConnectionRecovery = createContext({ resources: 0, lease: 0 });
export function useRecoveryRevision() {
  return useContext(ConnectionRecovery).resources;
}
export function useLeaseRevision() {
  return useContext(ConnectionRecovery).lease;
}
