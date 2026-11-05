export function webSourceProof(
  root: string,
  files: string[],
): { schema: number; inputs: { path: string; sha256: string }[] };
export function assertWebBuild(directory: string, root?: string): void;
export function webBuildProofPlugin(): import('vite').Plugin;
