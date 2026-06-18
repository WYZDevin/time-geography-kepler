import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

interface BackendProgressProps {
  /** Message shown next to the elapsed timer. */
  label?: string;
  /** Tailwind class for the moving fill. */
  barColor?: string;
  /** Tailwind class for the track background. */
  trackColor?: string;
  /** Tailwind class for the label + timer text. */
  textColor?: string;
  className?: string;
}

/**
 * Indeterminate progress bar with a live elapsed-seconds counter.
 *
 * The backend runs tools as a single blocking request with no progress
 * events, so there is no real percentage to show. Instead we animate a
 * sliding fill and tick an elapsed timer — together they reassure the user
 * that the backend is still working and the app has not frozen.
 *
 * The timer starts on mount, so render this only while a run is active.
 */
export function BackendProgress({
  label = 'Working… the backend is still running',
  barColor = 'bg-yellow-500',
  trackColor = 'bg-yellow-200/60',
  textColor = 'text-yellow-700',
  className,
}: BackendProgressProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - start) / 1000));
    }, 500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={className}>
      <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full', trackColor)}>
        <div className={cn('animate-indeterminate', barColor)} />
      </div>
      <div className={cn('mt-1.5 flex items-center justify-between text-xs', textColor)}>
        <span>{label}</span>
        <span className="tabular-nums">{elapsed}s</span>
      </div>
    </div>
  );
}
