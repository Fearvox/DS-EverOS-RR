/**
 * Module declarations for packages that Bun resolves at runtime but tsc cannot
 * find during strict-mode type checking. These shims allow the strict overlay
 * (tsconfig.strict.json) to focus on real type errors in hardened files rather
 * than module resolution failures.
 *
 * Each declaration uses minimal structural types — the actual runtime types are
 * correct, these shims only exist so tsc can proceed past import statements.
 */

// Anthropic SDK — resolved by Bun's module resolution at runtime
declare module '@anthropic-ai/sdk' {
  export type ContentBlockParam = { type: string; [key: string]: unknown }
  export type ContentBlock = { type: string; [key: string]: unknown }
  export type ToolResultBlockParam = { type: 'tool_result'; tool_use_id: string; content?: unknown; [key: string]: unknown }
  export type ToolUseBlockParam = { type: 'tool_use'; id: string; name: string; input: unknown; [key: string]: unknown }
}

declare module '@anthropic-ai/sdk/resources/index.mjs' {
  export type ContentBlockParam = import('@anthropic-ai/sdk').ContentBlockParam
  export type ContentBlock = import('@anthropic-ai/sdk').ContentBlock
  export type ToolResultBlockParam = import('@anthropic-ai/sdk').ToolResultBlockParam
  export type ToolUseBlockParam = import('@anthropic-ai/sdk').ToolUseBlockParam
}

declare module '@anthropic-ai/sdk/resources/messages.mjs' {
  export type ContentBlockParam = import('@anthropic-ai/sdk').ContentBlockParam
}

declare module '@anthropic-ai/sdk/resources/messages.js' {
  export type ContentBlockParam = import('@anthropic-ai/sdk').ContentBlockParam
}

declare module '@anthropic-ai/sdk/resources/beta/messages/messages.mjs' {
  export type BetaUsage = { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; [key: string]: unknown }
  export type BetaMessageStreamParams = { model: string; max_tokens: number; messages: Array<{ role: string; content: unknown }>; [key: string]: unknown }
}

// OpenTelemetry — optional instrumentation, not installed in dev
declare module '@opentelemetry/api' {
  export type Attributes = Record<string, unknown>
  export type Meter = { createCounter(name: string, options?: unknown): unknown; createHistogram(name: string, options?: unknown): unknown }
  export type MetricOptions = { description?: string; unit?: string }
}

declare module '@opentelemetry/api-logs' {
  export namespace logs {
    function getLogger(name: string): { emit(record: unknown): void }
  }
}

declare module '@opentelemetry/sdk-logs' {
  export type LoggerProvider = { getLogger(name: string): unknown; shutdown(): Promise<void> }
}

declare module '@opentelemetry/sdk-metrics' {
  export type MeterProvider = { getMeter(name: string): unknown; shutdown(): Promise<void> }
}

declare module '@opentelemetry/sdk-trace-base' {
  export type BasicTracerProvider = { getTracer(name: string): unknown; shutdown(): Promise<void> }
}

// lodash-es — Bun resolves ESM subpath imports at runtime
declare module 'lodash-es/sumBy.js' {
  function sumBy<T>(collection: T[], iteratee: string | ((value: T) => number)): number
  export default sumBy
}

declare module 'lodash-es/memoize.js' {
  function memoize<T extends (...args: unknown[]) => unknown>(fn: T): T
  export default memoize
}

// Node crypto UUID — Bun provides this but tsc may not resolve it
declare module 'crypto' {
  export type UUID = `${string}-${string}-${string}-${string}-${string}`
  export function randomUUID(): UUID
}

// React namespace and module — resolved by Bun but tsc needs declarations
declare namespace React {
  type ReactNode = any
  type ReactElement = any
  type JSX = any
  interface RefObject<T> {
    readonly current: T | null
  }
}

declare module 'react' {
  export = React
  export default React
}

declare module 'react/jsx-runtime' {
  export const jsx: any
  export const jsxs: any
  export const Fragment: any
}

declare module 'react/compiler-runtime' {
  export function c(size: number): any[]
}

// bun:test — Bun's built-in test runner
declare module 'bun:test' {
  export function describe(name: string, fn: () => void): void
  export function test(name: string, fn: () => void | Promise<void>): void
  export function expect(value: unknown): any
  export function beforeAll(fn: () => void | Promise<void>): void
  export function afterAll(fn: () => void | Promise<void>): void
  export function beforeEach(fn: () => void | Promise<void>): void
  export function afterEach(fn: () => void | Promise<void>): void
}

// axios — used by bridge modules (not installed as type dep)
declare module 'axios' {
  const axios: any
  export default axios
  export type AxiosInstance = any
  export type AxiosRequestConfig = any
  export type AxiosResponse = any
}

// figures — terminal symbol library
declare module 'figures' {
  const figures: Record<string, string>
  export default figures
}
