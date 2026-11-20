import { useEffect, useState } from 'react';

/**
 * Remaining time until a SERVER timestamp, corrected by the measured clock offset.
 * Re-renders ~5x/second - only used for the numeric label; the bar itself is
 * animated on the UI thread by Reanimated.
 */
export default function useServerCountdown(deadline, clockOffset) {
  const compute = () => (deadline ? Math.max(0, deadline - (Date.now() + clockOffset)) : 0);
  const [remaining, setRemaining] = useState(compute);

  useEffect(() => {
    setRemaining(compute());
    if (!deadline) return undefined;
    const id = setInterval(() => setRemaining(compute()), 200);
    return () => clearInterval(id);
  }, [deadline, clockOffset]); // eslint-disable-line react-hooks/exhaustive-deps

  return remaining;
}
