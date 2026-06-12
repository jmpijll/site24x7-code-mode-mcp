/**
 * Sandbox & tool limits — shared constants and types.
 */

export const MAX_CODE_SIZE = 100_000;
export const MAX_RESULT_SIZE = 100_000;
export const MAX_LOG_SIZE_BYTES = 1_048_576;
export const MAX_LOG_ENTRIES = 1_000;

export const DEFAULT_MAX_CALLS_PER_EXECUTE = 50;
export const DEFAULT_MAX_MEMORY_BYTES = 64 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 30_000;

export const SEARCH_TIMEOUT_MS = 10_000;
export const SEARCH_MAX_MEMORY_BYTES = 32 * 1024 * 1024;

export interface SandboxLimits {
  timeoutMs: number;
  maxMemoryBytes: number;
  maxCallsPerExecute: number;
}

export const DEFAULT_LIMITS: SandboxLimits = {
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxMemoryBytes: DEFAULT_MAX_MEMORY_BYTES,
  maxCallsPerExecute: DEFAULT_MAX_CALLS_PER_EXECUTE,
};
