import { AnimatePresence, motion, useIsPresent } from 'motion/react';
import { useMedia } from '../ui/motion';

function ActivityLabel({ label }: { label: string }) {
  const present = useIsPresent();
  const reduced = useMedia('(prefers-reduced-motion: reduce)');
  return (
    <motion.p
      className="pc-activity"
      data-settling={!present || undefined}
      initial={reduced ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.12 }}
    >
      {label}
    </motion.p>
  );
}

export function ActivityLine({ active, label }: { active: boolean; label: string }) {
  return (
    <div className="pc-activity-lane">
      <span className="sr-only" role="status" aria-atomic="true">
        {active ? label : ''}
      </span>
      <div aria-hidden="true">
        <AnimatePresence initial={false}>
          {active && <ActivityLabel key="activity" label={label} />}
        </AnimatePresence>
      </div>
    </div>
  );
}
