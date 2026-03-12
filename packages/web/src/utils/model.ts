const MODEL_DISPLAY_NAMES: Record<string, string> = {
  'opus': 'Opus 4.6',
  'claude-opus-4-6': 'Opus 4.6',
  'claude-opus-4-5-20250514': 'Opus 4.5',
  'sonnet': 'Sonnet 4.6',
  'claude-sonnet-4-6': 'Sonnet 4.6',
  'claude-sonnet-4-5-20250514': 'Sonnet 4.5',
  'haiku': 'Haiku 4.5',
  'claude-haiku-4-5-20251001': 'Haiku 4.5',
};

export function formatModelName(model?: string): string {
  if (!model) return 'Opus 4.6';
  return MODEL_DISPLAY_NAMES[model] || model;
}
