import type { LLMProvider, ProviderConfig, ProviderRouterConfig } from "./types.js";
import { OpenAICompatibleClient } from "./OpenAICompatibleClient.js";

// Singleton instance — initialized lazily from config file or env
let _instance: ProviderRouter | null = null;

/**
 * Known provider presets. Users can override via ~/.claude/providers.json
 */
export const PROVIDER_PRESETS: Record<string, Omit<ProviderConfig, 'apiKey'>> = {
  minimax: {
    name: 'minimax',
    providerClass: 'openai-compatible',
    modelName: 'MiniMax-M1',
    baseUrl: 'https://api.minimaxi.chat/v1',
  },
  codex: {
    name: 'codex',
    providerClass: 'openai-compatible',
    modelName: 'gpt-5.4',
    baseUrl: 'https://api.openai.com/v1',
  },
  gemini: {
    name: 'gemini',
    providerClass: 'openai-compatible',
    modelName: 'gemini-3.1-pro',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
  },
  anthropic: {
    name: 'anthropic',
    providerClass: 'anthropic',
    modelName: 'claude-opus-4-6',
    baseUrl: 'https://api.anthropic.com',
  },
  local: {
    name: 'local',
    providerClass: 'openai-compatible',
    modelName: 'Gemma-4-E4B-Uncensored-HauhauCS-Aggressive-Q4_K_M',
    baseUrl: 'http://127.0.0.1:1337/v1',
  },
  openrouter: {
    name: 'openrouter',
    providerClass: 'openai-compatible',
    modelName: 'anthropic/claude-sonnet-4.6',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  // OpenRouter benchmark presets — switch model via /provider or ~/.claude/providers.json
  'or-opus': {
    name: 'or-opus',
    providerClass: 'openai-compatible',
    modelName: 'anthropic/claude-opus-4.6',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  'or-gpt5': {
    name: 'or-gpt5',
    providerClass: 'openai-compatible',
    modelName: 'openai/gpt-5.4',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  'or-grok': {
    name: 'or-grok',
    providerClass: 'openai-compatible',
    modelName: 'x-ai/grok-4.20',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  'or-gemini': {
    name: 'or-gemini',
    providerClass: 'openai-compatible',
    modelName: 'google/gemini-3.1-pro-preview',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  'or-gpt5pro': {
    name: 'or-gpt5pro',
    providerClass: 'openai-compatible',
    modelName: 'openai/gpt-5.4-pro',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  'or-grok-fast': {
    name: 'or-grok-fast',
    providerClass: 'openai-compatible',
    modelName: 'x-ai/grok-4.1-fast',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  // Native xAI (direct API, not via OpenRouter)
  xai: {
    name: 'xai',
    providerClass: 'openai-compatible',
    modelName: 'grok-4.20-0309-reasoning',
    baseUrl: 'https://api.x.ai/v1',
  },
  'xai-multi': {
    name: 'xai-multi',
    providerClass: 'openai-compatible',
    modelName: 'grok-4.20-multi-agent-0309',
    baseUrl: 'https://api.x.ai/v1',
  },
  'xai-fast': {
    name: 'xai-fast',
    providerClass: 'openai-compatible',
    modelName: 'grok-4-1-fast-reasoning',
    baseUrl: 'https://api.x.ai/v1',
  },
  // Native MiMo (Xiaomi, direct API)
  mimo: {
    name: 'mimo',
    providerClass: 'openai-compatible',
    modelName: 'mimo-v2-pro',
    baseUrl: 'https://api.xiaomimimo.com/v1',
  },
  'mimo-flash': {
    name: 'mimo-flash',
    providerClass: 'openai-compatible',
    modelName: 'mimo-v2-flash',
    baseUrl: 'https://api.xiaomimimo.com/v1',
  },
  // 国产 TOP 模型 (via OpenRouter)
  'or-glm': {
    name: 'or-glm',
    providerClass: 'openai-compatible',
    modelName: 'z-ai/glm-5.1',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  'or-qwen-coder': {
    name: 'or-qwen-coder',
    providerClass: 'openai-compatible',
    modelName: 'qwen/qwen3-coder-plus',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  'or-kimi': {
    name: 'or-kimi',
    providerClass: 'openai-compatible',
    modelName: 'moonshotai/kimi-k2.5',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  'or-deepseek': {
    name: 'or-deepseek',
    providerClass: 'openai-compatible',
    modelName: 'deepseek/deepseek-r1-0528',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  'or-qwen': {
    name: 'or-qwen',
    providerClass: 'openai-compatible',
    modelName: 'qwen/qwen3.6-plus',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
  // or-kimi-k25 merged into or-kimi (both now kimi-k2.5)
  'or-minimax': {
    name: 'or-minimax',
    providerClass: 'openai-compatible',
    modelName: 'minimax/minimax-m1',
    baseUrl: 'https://openrouter.ai/api/v1',
  },
};

export function getProviderRouter(): ProviderRouter {
  if (!_instance) {
    _instance = ProviderRouter.fromEnvironment();
  }
  return _instance;
}

export function resetProviderRouter(): void {
  _instance = null;
}

export class ProviderRouter {
  private providers = new Map<string, LLMProvider>();
  readonly defaultProvider: string;
  private fallbackChain: string[];

  constructor(config: ProviderRouterConfig) {
    this.defaultProvider = config.defaultProvider;
    this.fallbackChain = config.fallbackChain ?? [config.defaultProvider];

    for (const providerConfig of config.providers) {
      const client = this.buildClient(providerConfig);
      if (client) {
        this.providers.set(providerConfig.name, client);
      }
    }
  }

  private buildClient(config: ProviderConfig): LLMProvider | null {
    switch (config.providerClass) {
      case "openai-compatible":
        return new OpenAICompatibleClient(config);
      case "anthropic":
        return {
          name: config.name,
          modelName: config.modelName,
          createMessage: async () => {
            throw new Error("Use existing Anthropic SDK path for Claude models");
          },
        };
      default:
        return null;
    }
  }

  getProvider(name: string): LLMProvider | null {
    return this.providers.get(name) ?? null;
  }

  getDefault(): LLMProvider | null {
    return this.getProvider(this.defaultProvider);
  }

  get availableProviders(): string[] {
    return [...this.providers.keys()];
  }

  getFallbackChain(): LLMProvider[] {
    return this.fallbackChain
      .map((name) => this.providers.get(name))
      .filter((p): p is LLMProvider => p !== null);
  }

  /**
   * Build a ProviderRouter from environment variables and optional config file.
   * Reads API keys from env: MINIMAX_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, ANTHROPIC_API_KEY
   */
  static fromEnvironment(): ProviderRouter {
    const providers: ProviderConfig[] = [];

    const keyMap: Record<string, string | undefined> = {
      minimax: process.env.MINIMAX_API_KEY,
      codex: process.env.OPENAI_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      local: 'no-key-needed', // Atomic Chat local server
      openrouter: process.env.OPENROUTER_API_KEY,
      'or-opus': process.env.OPENROUTER_API_KEY,
      'or-gpt5': process.env.OPENROUTER_API_KEY,
      'or-grok': process.env.OPENROUTER_API_KEY,
      'or-gemini': process.env.OPENROUTER_API_KEY,
      'or-gpt5pro': process.env.OPENROUTER_API_KEY,
      'or-grok-fast': process.env.OPENROUTER_API_KEY,
      'or-glm': process.env.OPENROUTER_API_KEY,
      'or-qwen-coder': process.env.OPENROUTER_API_KEY,
      'or-kimi': process.env.OPENROUTER_API_KEY,
      'or-deepseek': process.env.OPENROUTER_API_KEY,
      'or-qwen': process.env.OPENROUTER_API_KEY,
      // or-kimi-k25 merged into or-kimi
      'or-minimax': process.env.OPENROUTER_API_KEY,
      mimo: process.env.MIMO_API_KEY,
      'mimo-flash': process.env.MIMO_API_KEY,
      xai: process.env.XAI_API_KEY,
      'xai-multi': process.env.XAI_API_KEY,
      'xai-fast': process.env.XAI_API_KEY,
    };

    for (const [name, preset] of Object.entries(PROVIDER_PRESETS)) {
      const apiKey = keyMap[name];
      if (apiKey || name === 'anthropic') {
        providers.push({ ...preset, apiKey: apiKey ?? '' } as ProviderConfig);
      }
    }

    // Try loading user config file for overrides
    try {
      const fs = require('fs');
      const path = require('path');
      const configPath = path.join(process.env.HOME ?? '', '.claude', 'providers.json');
      if (fs.existsSync(configPath)) {
        const userConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        if (Array.isArray(userConfig.providers)) {
          for (const p of userConfig.providers) {
            // User config overrides presets
            const idx = providers.findIndex(x => x.name === p.name);
            if (idx >= 0) providers[idx] = { ...providers[idx], ...p };
            else providers.push(p);
          }
        }
      }
    } catch {
      // Config file is optional
    }

    return new ProviderRouter({
      providers,
      defaultProvider: 'xai-fast',  // Set to fastest generation model per user request
      fallbackChain: ['xai-fast', 'anthropic'],
    });
  }
}
