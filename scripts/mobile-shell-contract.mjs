export function fixedAppRoots(css) {
  const roots = new Set();
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\bposition\s*:\s*fixed\b/.test(match[2])) continue;
    for (const selector of match[1].split(',')) {
      const name = selector.trim();
      if (/^(?:html|body|#root|\.pc-shell)(?:\[[^\]]*\]|:has\([^)]*\))*$/.test(name))
        roots.add(name);
    }
  }
  return [...roots];
}
