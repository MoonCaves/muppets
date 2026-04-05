/**
 * Log accumulator — persists across tab switches using a module-level buffer.
 * The buffer lives outside React so it never causes re-renders on other tabs.
 * When the Dashboard mounts, it reads the buffer and subscribes to new lines.
 */

let logBuffer: string[] = [];
let subscriber: ((lines: string[]) => void) | null = null;
let ipcUnsubscribe: (() => void) | null = null;

export function initLogSubscription(): void {
  if (ipcUnsubscribe) return; // already subscribed
  const kb = (window as any).kyberbot;
  if (!kb) return;

  ipcUnsubscribe = kb.logs.onLine((line: string) => {
    logBuffer.push(line);
    if (logBuffer.length > 2000) logBuffer = logBuffer.slice(-2000);
    subscriber?.(logBuffer);
  });
}

export function getLogBuffer(): string[] {
  return logBuffer;
}

export function subscribeToLogs(cb: (lines: string[]) => void): () => void {
  subscriber = cb;
  return () => { subscriber = null; };
}
