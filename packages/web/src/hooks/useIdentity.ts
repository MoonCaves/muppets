import { useState, useEffect, useCallback } from 'react';
import { apiGet, apiPut } from '../api/client';
import type { IdentityConfig } from '../api/types';

export function useIdentity() {
  const [identity, setIdentity] = useState<IdentityConfig | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchIdentity = useCallback(async () => {
    try {
      const data = await apiGet<IdentityConfig>('/identity');
      setIdentity(data);
    } catch {
      setIdentity(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchIdentity();
  }, [fetchIdentity]);

  const updateIdentity = useCallback(async (changes: Partial<IdentityConfig>) => {
    await apiPut('/identity', changes);
    await fetchIdentity();
  }, [fetchIdentity]);

  return { identity, loading, updateIdentity };
}
