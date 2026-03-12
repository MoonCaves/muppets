import { useState, useEffect } from 'react';
import type { ServiceStatus } from '../api/types';

export function useStatus() {
  const [status, setStatus] = useState<ServiceStatus | null>(null);

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const token = sessionStorage.getItem('kyberbot_token');
        const res = await fetch('/api/web/status', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) setStatus(await res.json());
      } catch {
        // silent fail
      }
    };

    fetchStatus();
    const interval = setInterval(fetchStatus, 30000); // Poll every 30s
    return () => clearInterval(interval);
  }, []);

  return status;
}
