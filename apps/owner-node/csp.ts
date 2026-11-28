/** Voice providers the owner's browser talks to directly, with a short-lived token. */
export const voiceSockets = ['wss://api.elevenlabs.io', 'wss://api.x.ai'] as const;

/** Narrows the static policy's open `connect-src` to this server and the voice providers. */
export function ownerPolicy(policy: string, origin: string) {
  return policy.replace(
    "connect-src 'self' https: wss:",
    `connect-src 'self' ${origin.replace(/^https:/, 'wss:')} ${voiceSockets.join(' ')}`,
  );
}
