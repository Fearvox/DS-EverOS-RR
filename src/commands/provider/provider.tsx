import chalk from 'chalk';
import * as React from 'react';
import type { CommandResultDisplay } from '../../commands.js';
import { useAppState, useSetAppState } from '../../state/AppState.js';
import type { LocalJSXCommandCall } from '../../types/command.js';
import { getProviderRouter, PROVIDER_PRESETS } from '../../services/providers/ProviderRouter.js';
import { setActiveProvider } from '../../state/activeProvider.js';

const KNOWN_PROVIDERS = Object.keys(PROVIDER_PRESETS);

function ProviderInfo({ onDone }: { onDone: (msg: string, opts?: { display?: CommandResultDisplay }) => void }) {
  const activeProvider = useAppState(s => s.activeProvider);
  const router = getProviderRouter();
  const available = router.availableProviders;

  const lines = [
    `Active provider: ${chalk.bold.green(activeProvider)}`,
    '',
    'Available providers:',
    ...available.map(name => {
      const preset = PROVIDER_PRESETS[name];
      const indicator = name === activeProvider ? chalk.green('●') : chalk.dim('○');
      const model = preset?.modelName ?? 'custom';
      return `  ${indicator} ${chalk.bold(name)} — ${chalk.dim(model)}`;
    }),
    '',
    `Usage: ${chalk.dim('/provider <name>')} to switch`,
    `Config: ${chalk.dim('~/.claude/providers.json')} for custom providers`,
  ];

  onDone(lines.join('\n'));
  return null;
}

function SetProvider({
  name,
  onDone,
}: {
  name: string;
  onDone: (msg: string, opts?: { display?: CommandResultDisplay }) => void;
}) {
  const setAppState = useSetAppState();
  const router = getProviderRouter();

  React.useEffect(() => {
    const normalized = name.toLowerCase().trim();

    // Check if provider exists
    const provider = router.getProvider(normalized);
    if (!provider && normalized !== 'anthropic') {
      const available = router.availableProviders.join(', ');
      onDone(
        `Provider '${name}' not found. Available: ${available}\n` +
        `Add custom providers in ~/.claude/providers.json`,
        { display: 'system' }
      );
      return;
    }

    // Check if API key is configured (skip for anthropic — uses existing SDK)
    if (normalized !== 'anthropic' && !provider) {
      onDone(`Provider '${normalized}' has no API key configured. Set the appropriate env var.`, {
        display: 'system',
      });
      return;
    }

    // Sync module-level singleton (read by queryModel in claude.ts)
    setActiveProvider(normalized);

    setAppState(prev => ({
      ...prev,
      activeProvider: normalized,
      // When switching provider, also set the model to the provider's default
      ...(normalized !== 'anthropic' && provider
        ? { mainLoopModel: provider.modelName }
        : {}),
    }));

    const preset = PROVIDER_PRESETS[normalized];
    const modelInfo = provider?.modelName ?? preset?.modelName ?? 'default';
    onDone(
      `Switched to ${chalk.bold.green(normalized)} provider — model: ${chalk.bold(modelInfo)}`
    );
  }, [name, onDone, setAppState]);

  return null;
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  args = args?.trim() || '';

  if (!args || args === '?' || args === '--help') {
    return <ProviderInfo onDone={onDone} />;
  }

  return <SetProvider name={args} onDone={onDone} />;
};
