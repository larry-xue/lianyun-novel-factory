export const RUN_STATUS_VALUES = [
  'pending',
  'running',
  'success',
  'failure',
  'cancelled',
] as const;

export type RunStatus = (typeof RUN_STATUS_VALUES)[number];
