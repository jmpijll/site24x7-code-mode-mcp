/**
 * Execute executor — runs LLM-written JS that performs real Site24x7
 * API calls.
 *
 * Sandbox surface (set up by `buildSite24x7Prelude`):
 *   site24x7.<tag>.<op>(args)               → Promise
 *   site24x7.callOperation(opId, args)      → Promise
 *   site24x7.request({ method, path, ... }) → Promise
 *   site24x7.listCustomers()                → Promise
 *   site24x7.withCustomer(zaaid, fn)        → Promise (closure-scoped zaaid)
 *   site24x7.zaaid                          → string | undefined
 *   site24x7.spec                           → { title, sourceUrl, ... }
 *
 * Tenant credentials are bound at construction time. The host enforces
 * the per-execute call budget. Credentials never enter the sandbox.
 */

import { newAsyncContext, type QuickJSAsyncContext, type QuickJSHandle } from 'quickjs-emscripten';
import type { Site24x7HttpClient } from '../client/http.js';
import { Site24x7HttpError } from '../client/http.js';
import {
  buildSite24x7Prelude,
  dispatchListCustomers,
  dispatchOperation,
  dispatchRawRequest,
  UnknownOperationError,
} from './dispatch.js';
import { configureRuntimeLimits, formatError, setupConsole } from './executor.js';
import { DEFAULT_LIMITS, type SandboxLimits } from './limits.js';
import type { ExecuteResult, LogEntry } from './types.js';
import { MissingCredentialsError, MissingZaaidError, type TenantContext } from '../types/tenant.js';
import type { ProcessedSpec } from '../types/spec.js';

export interface ExecuteExecutorOptions {
  tenant: TenantContext;
  spec: ProcessedSpec;
  client: Site24x7HttpClient;
  limits?: Partial<SandboxLimits>;
}

export class ExecuteExecutor {
  private readonly tenant: TenantContext;
  private readonly spec: ProcessedSpec;
  private readonly client: Site24x7HttpClient;
  private readonly limits: SandboxLimits;

  constructor(opts: ExecuteExecutorOptions) {
    this.tenant = opts.tenant;
    this.spec = opts.spec;
    this.client = opts.client;
    this.limits = { ...DEFAULT_LIMITS, ...opts.limits };
  }

  async execute(code: string): Promise<ExecuteResult> {
    const startTime = Date.now();
    const logs: LogEntry[] = [];
    const warnings: string[] = [];
    let callsMade = 0;

    const context = await newAsyncContext();
    const runtime = context.runtime;

    try {
      configureRuntimeLimits(runtime, this.limits);
      setupConsole(context, logs);

      const callBudgetGuard = (): void => {
        callsMade += 1;
        if (callsMade > this.limits.maxCallsPerExecute) {
          throw new Error(
            `[site24x7.error] API call limit exceeded (max ${String(this.limits.maxCallsPerExecute)} calls per execute). Batch with Promise.all, split across calls, or raise SITE24X7_MAX_CALLS_PER_EXECUTE.`,
          );
        }
      };

      this.bindHostFunctions(context, callBudgetGuard);

      const prelude = buildSite24x7Prelude(this.spec, this.tenant.zaaid);
      const preludeResult = context.evalCode(prelude, 'prelude.js', { type: 'global' });
      if (preludeResult.error) {
        const errValue: unknown = context.dump(preludeResult.error);
        preludeResult.error.dispose();
        throw new Error(
          `[site24x7.error] failed to bootstrap site24x7 namespace: ${formatError(errValue)}`,
        );
      }
      preludeResult.value.dispose();

      const result = await context.evalCodeAsync(code, 'sandbox.js', { type: 'global' });
      if (result.error) {
        const errorValue: unknown = context.dump(result.error);
        result.error.dispose();
        return {
          ok: false,
          error: formatError(errorValue),
          logs,
          warnings,
          callsMade,
          durationMs: Date.now() - startTime,
        };
      }

      const valueHandle = result.value;
      try {
        if (context.typeof(valueHandle) !== 'object') {
          return {
            ok: true,
            data: context.dump(valueHandle),
            logs,
            warnings,
            callsMade,
            durationMs: Date.now() - startTime,
          };
        }

        const initial = context.getPromiseState(valueHandle);
        if (initial.type === 'fulfilled' && initial.notAPromise === true) {
          return {
            ok: true,
            data: context.dump(valueHandle),
            logs,
            warnings,
            callsMade,
            durationMs: Date.now() - startTime,
          };
        }

        const maxDrains = 1000;
        for (let i = 0; i < maxDrains; i += 1) {
          const state = context.getPromiseState(valueHandle);
          if (state.type === 'fulfilled') {
            const dumped: unknown = context.dump(state.value);
            state.value.dispose();
            return {
              ok: true,
              data: dumped,
              logs,
              warnings,
              callsMade,
              durationMs: Date.now() - startTime,
            };
          }
          if (state.type === 'rejected') {
            const dumped: unknown = context.dump(state.error);
            state.error.dispose();
            return {
              ok: false,
              error: formatError(dumped),
              logs,
              warnings,
              callsMade,
              durationMs: Date.now() - startTime,
            };
          }
          const drain = runtime.executePendingJobs(64);
          if (drain.error) {
            const errorValue: unknown = context.dump(drain.error);
            drain.error.dispose();
            return {
              ok: false,
              error: formatError(errorValue),
              logs,
              warnings,
              callsMade,
              durationMs: Date.now() - startTime,
            };
          }
          await new Promise<void>((r) => setImmediate(r));
        }
        return {
          ok: false,
          error: '[site24x7.error] sandbox promise did not settle within microtask budget',
          logs,
          warnings,
          callsMade,
          durationMs: Date.now() - startTime,
        };
      } finally {
        valueHandle.dispose();
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        logs,
        warnings,
        callsMade,
        durationMs: Date.now() - startTime,
      };
    } finally {
      try {
        context.dispose();
      } catch {
        /* swallow disposal-time WASM aborts */
      }
      try {
        runtime.dispose();
      } catch {
        /* swallow disposal-time WASM aborts */
      }
    }
  }

  private bindHostFunctions(context: QuickJSAsyncContext, callBudgetGuard: () => void): void {
    const callFn = context.newAsyncifiedFunction(
      '__site24x7Call',
      async (opIdHandle: QuickJSHandle, argsJsonHandle: QuickJSHandle) => {
        const opId = context.getString(opIdHandle);
        const argsJson = context.getString(argsJsonHandle);
        try {
          callBudgetGuard();
          const args = parseJson(argsJson);
          const response = await dispatchOperation(this.client, this.tenant, this.spec, opId, args);
          return context.newString(encodeOk(response.data));
        } catch (err) {
          return context.newString(encodeErr(err));
        }
      },
    );
    context.setProp(context.global, '__site24x7Call', callFn);
    callFn.dispose();

    const rawFn = context.newAsyncifiedFunction(
      '__site24x7Raw',
      async (argsJsonHandle: QuickJSHandle) => {
        const argsJson = context.getString(argsJsonHandle);
        try {
          callBudgetGuard();
          const args = parseJson(argsJson) as unknown as Parameters<typeof dispatchRawRequest>[2];
          const response = await dispatchRawRequest(this.client, this.tenant, args);
          return context.newString(encodeOk(response.data));
        } catch (err) {
          return context.newString(encodeErr(err));
        }
      },
    );
    context.setProp(context.global, '__site24x7Raw', rawFn);
    rawFn.dispose();

    const listFn = context.newAsyncifiedFunction('__site24x7ListCustomers', async () => {
      try {
        callBudgetGuard();
        const data = await dispatchListCustomers(this.client, this.tenant);
        return context.newString(encodeOk(data));
      } catch (err) {
        return context.newString(encodeErr(err));
      }
    });
    context.setProp(context.global, '__site24x7ListCustomers', listFn);
    listFn.dispose();
  }
}

function encodeOk(data: unknown): string {
  return JSON.stringify({ ok: true, data: data ?? null });
}

function encodeErr(err: unknown): string {
  return JSON.stringify({ ok: false, error: formatNamespacedError(err) });
}

function formatNamespacedError(err: unknown): string {
  if (err instanceof Site24x7HttpError) return err.message;
  if (err instanceof MissingCredentialsError) return err.message;
  if (err instanceof MissingZaaidError) return err.message;
  if (err instanceof UnknownOperationError) return err.message;
  if (err instanceof Error) {
    return err.message.startsWith('[site24x7.') ? err.message : `[site24x7.error] ${err.message}`;
  }
  return `[site24x7.error] ${String(err)}`;
}

function parseJson(json: string): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>;
    return {};
  } catch {
    return {};
  }
}
