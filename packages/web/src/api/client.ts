export const getToken = (): string | null => {
  return localStorage.getItem('kyberbot_token');
};

const getHeaders = (): HeadersInit => {
  const headers: HeadersInit = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
};

export async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(`/api/web${path}`, { headers: getHeaders() });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/web${path}`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/web${path}`, {
    method: 'PUT',
    headers: getHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`API error: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

export function createChatStream(prompt: string): { reader: ReadableStreamDefaultReader<Uint8Array>; abort: () => void } {
  const controller = new AbortController();
  const token = getToken();

  const fetchPromise = fetch('/api/web/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ prompt }),
    signal: controller.signal,
  });

  // We return a promise-based reader
  const readerPromise = fetchPromise.then(res => {
    if (!res.ok) throw new Error(`Chat error: ${res.status}`);
    return res.body!.getReader();
  });

  // Create a wrapper that lazily resolves
  let resolvedReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  const proxyReader = {
    read: async () => {
      if (!resolvedReader) {
        resolvedReader = await readerPromise;
      }
      return resolvedReader.read();
    },
    cancel: async () => {
      if (resolvedReader) await resolvedReader.cancel();
    },
  } as ReadableStreamDefaultReader<Uint8Array>;

  return {
    reader: proxyReader,
    abort: () => controller.abort(),
  };
}
