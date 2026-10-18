import { forwardRef, useImperativeHandle, useRef } from 'react';

export type AudioActivityHandle = { update: (level: number) => void };

/** Live amplitude only: silence settles to a line rather than a simulated conversation. */
export const AudioActivity = forwardRef<AudioActivityHandle>(function AudioActivity(_, ref) {
  const bars = useRef<HTMLDivElement>(null);
  const phase = useRef(0);
  useImperativeHandle(ref, () => ({
    update(level) {
      phase.current += 0.4;
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const amplitude = Math.max(0, Math.min(1, level));
      for (const [index, bar] of [...(bars.current?.children ?? [])].entries()) {
        if (!(bar instanceof HTMLElement)) continue;
        const wave = reduced ? 0.65 : 0.35 + Math.abs(Math.sin(index * 0.8 + phase.current)) * 0.65;
        bar.style.scale = `1 ${0.12 + amplitude * wave * 0.88}`;
      }
    },
  }));
  return (
    <div
      data-slot="audio-activity"
      ref={bars}
      className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden text-foreground/65"
      aria-hidden="true"
    >
      {Array.from({ length: 23 }, (_, index) => (
        <span
          key={index}
          className="h-6 w-0.5 shrink-0 scale-y-[.12] rounded-full bg-current transition-[scale] duration-100 ease-out motion-reduce:transition-none"
        />
      ))}
    </div>
  );
});
