/**
 * Subscribe to health updates from main process.
 */

import { useState, useEffect } from 'react';
import type { HealthData } from '../../types/ipc';

export function useHealth() {
  const [health, setHealth] = useState<HealthData | null>(null);

  useEffect(() => {
    const kb = (window as any).kyberbot;
    if (!kb) return;

    // Get initial
    kb.services.getStatus().then(({ health: h }: { health: HealthData | null }) => {
      if (h) setHealth(h);
    });

    // Subscribe to updates
    return kb.services.onHealthUpdate((h: HealthData) => setHealth(h));
  }, []);

  return health;
}
