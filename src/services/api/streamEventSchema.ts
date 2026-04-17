/**
 * Zod runtime validation schema for BetaRawMessageStreamEvent shapes.
 *
 * Design principles (per D-04, D-05, D-11, D-12):
 * - API boundary ONLY: validate events as they enter from the Anthropic SDK stream.
 * - Parse what we consume, passthrough what we don't — z.passthrough() on sub-objects.
 * - z.discriminatedUnion on 'type' field so new event types extend naturally.
 * - parseStreamEvent throws ZodError with descriptive message on invalid input.
 *
 * Event types covered: exactly the types consumed in the switch statement in
 * src/services/api/claude.ts (lines ~1980-2298). No more, no less.
 *
 * Wiring: this schema is defined here (Phase 1) and will be imported in claude.ts
 * streaming loop in Phase 3. Do not import from claude.ts in this file.
 */
import { z } from 'zod/v4'

// ---------------------------------------------------------------------------
// Sub-schemas for nested shapes we consume (passthrough on fields we don't read)
// ---------------------------------------------------------------------------

const betaUsageSchema = z
  .object({
    input_tokens: z.number(),
    output_tokens: z.number(),
    cache_creation_input_tokens: z.number().optional(),
    cache_read_input_tokens: z.number().optional(),
  })
  .passthrough()

const betaMessageSchema = z
  .object({
    id: z.string(),
    type: z.literal('message'),
    role: z.literal('assistant'),
    content: z.array(z.unknown()),
    model: z.string(),
    stop_reason: z.string().nullable().optional(),
    stop_sequence: z.string().nullable().optional(),
    usage: betaUsageSchema,
  })
  .passthrough()

const messageDeltaUsageSchema = z
  .object({
    output_tokens: z.number(),
  })
  .passthrough()

// ---------------------------------------------------------------------------
// Content block delta sub-schemas — one per delta.type consumed in claude.ts
// ---------------------------------------------------------------------------

const textDeltaSchema = z.object({
  type: z.literal('text_delta'),
  text: z.string(),
})

const inputJsonDeltaSchema = z.object({
  type: z.literal('input_json_delta'),
  partial_json: z.string(),
})

const thinkingDeltaSchema = z.object({
  type: z.literal('thinking_delta'),
  thinking: z.string(),
})

const signatureDeltaSchema = z.object({
  type: z.literal('signature_delta'),
  signature: z.string(),
})

const citationsDeltaSchema = z
  .object({
    type: z.literal('citations_delta'),
  })
  .passthrough()

/**
 * Fallback for delta types we don't destructure (e.g. connector_text_delta
 * behind feature flag, or future SDK additions). Placed last in the union
 * so known types match first.
 */
const unknownDeltaSchema = z
  .object({
    type: z.string(),
  })
  .passthrough()

const betaDeltaSchema = z.union([
  textDeltaSchema,
  inputJsonDeltaSchema,
  thinkingDeltaSchema,
  signatureDeltaSchema,
  citationsDeltaSchema,
  unknownDeltaSchema,
])

// ---------------------------------------------------------------------------
// Content block schema — passthrough for fields we don't destructure at start
// ---------------------------------------------------------------------------

const contentBlockSchema = z
  .object({
    type: z.string(),
  })
  .passthrough()

// ---------------------------------------------------------------------------
// Main event discriminated union
// Covers every event type switched on in claude.ts streaming loop.
// ---------------------------------------------------------------------------

export const streamEventSchema = z.discriminatedUnion('type', [
  // message_start: part.message accessed, part.message.usage consumed
  z.object({
    type: z.literal('message_start'),
    message: betaMessageSchema,
  }),

  // content_block_start: part.index, part.content_block consumed
  z.object({
    type: z.literal('content_block_start'),
    index: z.number(),
    content_block: contentBlockSchema,
  }),

  // content_block_delta: part.index, part.delta consumed (multiple delta types)
  z
    .object({
      type: z.literal('content_block_delta'),
      index: z.number(),
      delta: betaDeltaSchema,
    })
    .passthrough(),

  // content_block_stop: part.index consumed
  z.object({
    type: z.literal('content_block_stop'),
    index: z.number(),
  }),

  // message_delta: part.usage, part.delta.stop_reason consumed
  z.object({
    type: z.literal('message_delta'),
    delta: z
      .object({
        stop_reason: z.string().nullable().optional(),
        stop_sequence: z.string().nullable().optional(),
      })
      .passthrough(),
    usage: messageDeltaUsageSchema,
  }),

  // message_stop: no fields accessed
  z.object({
    type: z.literal('message_stop'),
  }),

  // error: part of stream protocol — surface SDK errors at parse boundary
  z.object({
    type: z.literal('error'),
    error: z
      .object({
        type: z.string(),
        message: z.string(),
      })
      .passthrough(),
  }),
])

export type ParsedStreamEvent = z.infer<typeof streamEventSchema>

/**
 * Parse a raw stream event from the Anthropic SDK.
 *
 * Throws ZodError with structured error details if the event does not match
 * any known event type or is missing required fields. This is intentional --
 * unknown event shapes at the API boundary indicate an SDK version mismatch
 * and should surface immediately, not silently corrupt conversation state.
 *
 * Call site (Phase 3): in the streaming loop in claude.ts, wrap each event
 * with parseStreamEvent() before processing it.
 */
export function parseStreamEvent(raw: unknown): ParsedStreamEvent {
  return streamEventSchema.parse(raw)
}

/**
 * Safe variant -- returns null on parse failure instead of throwing.
 * Use only in contexts where partial event recovery is acceptable
 * (e.g., logging unknown events for diagnostic purposes).
 */
export function safeParseStreamEvent(raw: unknown): ParsedStreamEvent | null {
  const result = streamEventSchema.safeParse(raw)
  return result.success ? result.data : null
}
