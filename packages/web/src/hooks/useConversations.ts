import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../api/client';

export interface SessionSummary {
  id: string;
  channel: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
}

export function useConversations() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch_ = useCallback(async () => {
    try {
      const data = await apiGet<{ sessions: SessionSummary[] }>('/sessions');
      setSessions(data.sessions);
    } catch {
      // Silently fail — conversations panel is optional
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch_();
    const interval = setInterval(fetch_, 60_000);
    return () => clearInterval(interval);
  }, [fetch_]);

  return { sessions, loading, refresh: fetch_ };
}
