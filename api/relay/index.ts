import type { VercelRequest, VercelResponse } from '@vercel/node'
import { encryptRelayPayload, decryptRelayPayload } from './crypto.js'

// Environment variables (set in Vercel dashboard):
// RELAY_KEY=64-char-hex
// ANTHROPIC_API_KEY=sk-ant-...
// MINIMAX_API_KEY=...
// CODEX_API_KEY=...
// GEMINI_API_KEY=...
// VERTEX_API_KEY=...
// BEDROCK_AWS_ACCESS_KEY_ID=...
// BEDROCK_AWS_SECRET_ACCESS_KEY=...

const PROVIDER_ENDPOINTS: Record<string, {
  url: string
  authHeader: string
  envKey: string
  bodyFormat?: 'anthropic' | 'openai'
}> = {
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    authHeader: 'x-api-key',
    envKey: 'ANTHROPIC_API_KEY',
    bodyFormat: 'anthropic',
  },
  minimax: {
    url: 'https://api.minimaxi.chat/v1/chat/completions',
    authHeader: 'authorization',
    envKey: 'MINIMAX_API_KEY',
    bodyFormat: 'openai',
  },
  codex: {
    url: 'https://api.openai.com/v1/chat/completions',
    authHeader: 'authorization',
    envKey: 'CODEX_API_KEY',
    bodyFormat: 'openai',
  },
  gemini: {
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    authHeader: 'authorization',
    envKey: 'GEMINI_API_KEY',
    bodyFormat: 'openai',
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    authHeader: 'authorization',
    envKey: 'OPENROUTER_API_KEY',
    bodyFormat: 'openai',
  },
  vertex: {
    url: 'https://vertexai.googleapis.com/v1beta1/publishers/google/models',
    authHeader: 'authorization',
    envKey: 'VERTEX_API_KEY',
    bodyFormat: 'openai',
  },
  bedrock: {
    url: 'https://bedrock-runtime.us-east-1.amazonaws.com/model/anthropic.claude-3-5-sonnet-v1/max',
    authHeader: 'x-amz-authorization',
    envKey: 'BEDROCK_AWS_SECRET_ACCESS_KEY',
    bodyFormat: 'openai',
  },
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  // DEBUG: check env state
  if (req.query['debug'] === 'env') {
    const k = process.env['RELAY_KEY'] ?? ''
    res.json({
      RELAY_KEY_len: k.length,
      RELAY_KEY_hex: k.match(/^[0-9a-f]{64}$/) ? 'VALID' : 'INVALID',
      RELAY_KEY_chars: [...k].slice(0,8).map(c=>c.charCodeAt(0)),
      hasMinimax: !!process.env['MINIMAX_API_KEY'],
    })
    return
  }

  // DEBUG: test decryption step-by-step (POST with body containing encrypted)
  if (req.query['debug'] === 'decrypt') {
    const { encrypted, relayKey: clientKey } = req.body as { encrypted?: string; relayKey?: string }
    const serverKey = process.env['RELAY_KEY'] ?? ''
    try {
      if (!encrypted) {
        res.json({ error: 'no encrypted field', body_keys: Object.keys(req.body ?? {}) })
        return
      }
      const parts = encrypted.split(':')
      res.json({
        debug: true,
        encrypted_len: encrypted.length,
        encrypted_preview: encrypted.slice(0, 40) + '...',
        parts_count: parts.length,
        parts_preview: parts.map(p => p.slice(0, 20)),
        server_key_len: serverKey.length,
        server_key_valid: /^[0-9a-f]{64}$/.test(serverKey) ? 'VALID' : 'INVALID',
        client_key_len: (clientKey ?? '').length,
        client_key_valid: clientKey ? /^[0-9a-f]{64}$/.test(clientKey) ? 'VALID' : 'INVALID' : 'NOT_PROVIDED',
        key_match: serverKey === (clientKey ?? ''),
      })
    } catch(e: any) {
      res.json({ error: e.message })
    }
    return
  }

  // DEBUG: full decrypt test (POST with body containing encrypted + relayKey)
  if (req.query['debug'] === 'full-decrypt') {
    const { encrypted, relayKey: clientKey } = req.body as { encrypted?: string; relayKey?: string }
    const serverKey = process.env['RELAY_KEY'] ?? ''
    try {
      const { decryptRelayPayload } = await import('./crypto.js')
      const result = decryptRelayPayload(encrypted!, clientKey ?? serverKey)
      res.json({ ok: true, payload: result })
    } catch(e: any) {
      res.json({
        error: e.message,
        stack: e.stack?.split('\n').slice(0, 3),
        server_key_len: serverKey.length,
        encrypted_len: encrypted?.length,
      })
    }
    return
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const { encrypted, provider, model } = req.body as {
    encrypted?: string
    provider?: string
    model?: string
  }

  // Mode 1: Encrypted payload (existing protocol)
  if (encrypted && provider) {
    const relayKey = process.env.RELAY_KEY
    if (!relayKey) {
      res.status(500).json({ error: 'RELAY_KEY not configured' })
      return
    }
    let originalPayload: object
    try {
      originalPayload = decryptRelayPayload(encrypted, relayKey)
    } catch {
      res.status(400).json({ error: 'Decryption failed' })
      return
    }
    const providerConfig = PROVIDER_ENDPOINTS[provider]
    if (!providerConfig) {
      res.status(400).json({ error: `Unknown provider: ${provider}` })
      return
    }
    const apiKey = process.env[providerConfig.envKey]
    if (!apiKey) {
      res.status(500).json({ error: `API key for ${provider} not configured` })
      return
    }
    await forwardToProvider(res, providerConfig, apiKey, originalPayload, true)
    return
  }

  // Mode 2: Plain JSON with model field (CCR SDK direct path)
  if (model) {
    // Infer provider from model name
    const inferredProvider = inferProviderFromModel(model)
    if (!inferredProvider) {
      res.status(400).json({ error: `Cannot infer provider for model: ${model}` })
      return
    }
    const providerConfig = PROVIDER_ENDPOINTS[inferredProvider]
    if (!providerConfig) {
      res.status(400).json({ error: `Unknown provider: ${inferredProvider}` })
      return
    }
    const apiKey = process.env[providerConfig.envKey]
    if (!apiKey) {
      res.status(500).json({ error: `API key for ${inferredProvider} not configured` })
      return
    }
    // Route: stream=true + openai-format provider → SSE translation; else non-streaming + transform
    const wantsStream = (req.body as { stream?: unknown })?.stream === true
    if (wantsStream && providerConfig.bodyFormat === 'openai') {
      await forwardToProviderStream(res, providerConfig, apiKey, req.body, model)
    } else {
      await forwardToProvider(res, providerConfig, apiKey, req.body, false)
    }
    return
  }

  res.status(400).json({ error: 'Missing encrypted/provider or model field' })
}

/**
 * Transform OpenAI/MiniMax response format to Anthropic format.
 * MiniMax returns OpenAI chat completions format, but the SDK expects Anthropic message format.
 */
function transformToAnthropicFormat(responseData: any): object {
  // If already in Anthropic format (has type: 'message'), return as-is
  if (responseData?.type === 'message') {
    return responseData
  }

  // OpenAI/MiniMax format: { id, object, model, choices: [{ message: { role, content }, finish_reason }], usage }
  if (responseData?.choices && Array.isArray(responseData.choices)) {
    const choice = responseData.choices[0]
    const message = choice?.message
    const finishReason = choice?.finish_reason

    // Map finish_reason: 'stop' -> 'end_turn', 'length' -> 'max_tokens'
    let stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' | null = null
    if (finishReason === 'stop') {
      stopReason = 'end_turn'
    } else if (finishReason === 'length') {
      stopReason = 'max_tokens'
    } else if (finishReason === 'tool_calls') {
      stopReason = 'end_turn'
    }

    // Transform content to Anthropic format (array of text blocks)
    let content: Array<{ type: 'text'; text: string }> = []
    if (message?.content) {
      if (typeof message.content === 'string') {
        content = [{ type: 'text', text: message.content }]
      } else if (Array.isArray(message.content)) {
        // Already array format - pass through
        content = message.content
      }
    }

    return {
      id: responseData.id || `msg_${Date.now()}`,
      type: 'message',
      role: message?.role || 'assistant',
      content,
      model: responseData.model || 'unknown',
      stop_reason: stopReason,
      stop_sequence: null,
      usage: {
        input_tokens: responseData.usage?.prompt_tokens || 0,
        output_tokens: responseData.usage?.completion_tokens || 0,
        cache_creation_input_tokens: responseData.usage?.cache_creation_input_tokens || 0,
        cache_read_input_tokens: responseData.usage?.cache_read_input_tokens || 0,
      },
    }
  }

  // Fallback: return as-is (some error responses)
  return responseData
}

/** Infer provider from model name */
function inferProviderFromModel(model: string): string | null {
  const m = model.toLowerCase()
  if (m.includes('minimax')) return 'minimax'
  if (m.includes('grok') || m.includes('xai')) return 'xai'
  if (m.includes('claude') || m.includes('anthropic')) return 'anthropic'
  if (m.includes('gpt') || m.includes('openai')) return 'codex'
  if (m.includes('gemini') || m.includes('google')) return 'gemini'
  if (m.includes('deepseek')) return 'openrouter'
  if (m.includes('openrouter')) return 'openrouter'
  // fallback: check if it's an OpenRouter model path
  if (m.includes('/')) return 'openrouter'
  return null
}

async function forwardToProvider(
  res: VercelResponse,
  providerConfig: (typeof PROVIDER_ENDPOINTS)['minimax'],
  apiKey: string,
  payload: object,
  encryptResponse: boolean,
): Promise<void> {
  // Force non-streaming: MiniMax returns SSE but our transform expects JSON.
  // CCR SDK handles both streaming and non-streaming responses.
  const relayPayload = { ...payload, stream: false }

  let providerResponse: Response
  try {
    providerResponse = await fetch(providerConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        [providerConfig.authHeader]: providerConfig.authHeader === 'authorization' ? `Bearer ${apiKey}` : apiKey,
      },
      body: JSON.stringify(relayPayload),
    })
  } catch (err) {
    res.status(502).json({ error: `Upstream fetch failed: ${err}` })
    return
  }

  const responseData = await providerResponse.json().catch(() => ({
    error: `Non-JSON response: ${providerResponse.status}`,
  }))

  if (encryptResponse) {
    const relayKey = process.env.RELAY_KEY ?? ''
    try {
      const encryptedResponse = encryptRelayPayload(responseData, relayKey)
      res.status(200).json({ encrypted: encryptedResponse })
    } catch {
      res.status(500).json({ error: 'Response encryption failed' })
    }
  } else {
    // Plain JSON mode: transform OpenAI/MiniMax response to Anthropic format
    // The SDK expects Anthropic format but MiniMax returns OpenAI format
    const anthropicResponse = transformToAnthropicFormat(responseData)
    res.status(200).json(anthropicResponse)
  }
}

/**
 * Stream-mode: forward request with stream=true, translate OpenAI SSE chunks
 * to Anthropic SSE events on the fly. Used for MiniMax/Codex/Gemini/OpenRouter
 * when the caller opts into streaming (req.body.stream === true).
 *
 * Anthropic SSE event sequence:
 *   message_start → content_block_start → content_block_delta* → content_block_stop
 *   → message_delta → message_stop
 *
 * OpenAI SSE chunk shape:
 *   data: { choices: [{ delta: { content }, finish_reason }], usage? }
 *   data: [DONE]
 */
async function forwardToProviderStream(
  res: VercelResponse,
  providerConfig: (typeof PROVIDER_ENDPOINTS)['minimax'],
  apiKey: string,
  payload: object,
  model: string,
): Promise<void> {
  const relayPayload = { ...payload, stream: true }

  let upstream: Response
  try {
    upstream = await fetch(providerConfig.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        [providerConfig.authHeader]:
          providerConfig.authHeader === 'authorization' ? `Bearer ${apiKey}` : apiKey,
      },
      body: JSON.stringify(relayPayload),
    })
  } catch (err) {
    res.status(502).json({ error: `Upstream fetch failed: ${err}` })
    return
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => '')
    res.status(upstream.status || 502).json({
      error: `Upstream ${upstream.status}: ${errText.slice(0, 500)}`,
    })
    return
  }

  // Set SSE headers on response BEFORE any write (cannot be changed after flushHeaders)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no') // disable proxy buffering
  res.status(200)

  const writeEvent = (event: string, data: object): void => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  let started = false
  let stopReason: 'end_turn' | 'max_tokens' | 'stop_sequence' = 'end_turn'
  let outputTokens = 0
  let inputTokens = 0
  let cacheCreationTokens = 0
  let cacheReadTokens = 0

  const startMessage = (): void => {
    if (started) return
    started = true
    writeEvent('message_start', {
      type: 'message_start',
      message: {
        id: msgId,
        type: 'message',
        role: 'assistant',
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    })
    writeEvent('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    })
  }

  const reader = upstream.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let idx: number
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const rawLine = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!rawLine || !rawLine.startsWith('data:')) continue

        const dataStr = rawLine.slice(5).trim()
        if (dataStr === '[DONE]') continue

        let chunk: any
        try {
          chunk = JSON.parse(dataStr)
        } catch {
          continue // skip malformed line
        }

        const choice = chunk?.choices?.[0]
        const deltaContent: string | undefined = choice?.delta?.content
        const finishReason: string | undefined = choice?.finish_reason

        if (chunk?.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? inputTokens
          outputTokens = chunk.usage.completion_tokens ?? outputTokens
          cacheCreationTokens = chunk.usage.cache_creation_input_tokens ?? cacheCreationTokens
          cacheReadTokens = chunk.usage.cache_read_input_tokens ?? cacheReadTokens
        }

        if (deltaContent) {
          startMessage()
          writeEvent('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: deltaContent },
          })
        }

        if (finishReason) {
          if (finishReason === 'length') stopReason = 'max_tokens'
          else if (finishReason === 'stop' || finishReason === 'tool_calls') stopReason = 'end_turn'
        }
      }
    }
  } catch (err) {
    // Best-effort: emit error as message_delta + message_stop so client can finalize
    startMessage()
    writeEvent('content_block_stop', { type: 'content_block_stop', index: 0 })
    writeEvent('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: outputTokens },
    })
    writeEvent('message_stop', { type: 'message_stop' })
    res.end()
    console.error('[relay stream] reader error:', err)
    return
  }

  // Flush any trailing buffered line (some providers omit final newline)
  if (buffer.trim().startsWith('data:')) {
    const tail = buffer.trim().slice(5).trim()
    if (tail && tail !== '[DONE]') {
      try {
        const chunk = JSON.parse(tail)
        const deltaContent = chunk?.choices?.[0]?.delta?.content
        if (deltaContent) {
          startMessage()
          writeEvent('content_block_delta', {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: deltaContent },
          })
        }
      } catch { /* ignore */ }
    }
  }

  // Ensure we emit at least the skeleton even if provider returned no deltas
  startMessage()

  writeEvent('content_block_stop', { type: 'content_block_stop', index: 0 })
  writeEvent('message_delta', {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: cacheCreationTokens,
      cache_read_input_tokens: cacheReadTokens,
    },
  })
  writeEvent('message_stop', { type: 'message_stop' })
  res.end()
}
