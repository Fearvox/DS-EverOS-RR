/**
 * EscalationPrompt -- Ink component for structured escalation request approval.
 *
 * Purpose: PERM-04 requires "the agent can present a structured escalation request
 * that the user approves or rejects." This component renders such requests using
 * the standard PermissionDialog + PermissionPrompt pattern (same as other permission
 * prompts, but with only approve/reject options since escalations are session-scoped
 * by design and cannot be "always allowed").
 *
 * Key design decisions from Phase 07 precedent (DeliberationWarning.tsx):
 * - Written as STANDARD React (not decompiled _c() style) -- new components use
 *   standard React even though the codebase has heavy decompilation artifacts.
 * - Uses PermissionDialog as the container (standard pattern across all prompts).
 * - Uses PermissionPrompt for the selection widget (reuses existing select UX).
 * - No "always allow" option -- escalations are session-only, not persistent.
 */
import React, { useCallback, useMemo } from 'react'
import { Box, Text, useTheme } from '../../ink.js'
import type { EscalationRequest } from '../../utils/permissions/escalation/types.js'
import { PermissionDialog } from './PermissionDialog.js'
import { PermissionPrompt, type PermissionPromptOption } from './PermissionPrompt.js'

export type EscalationPromptProps = {
  request: EscalationRequest
  onApprove: () => void
  onReject: () => void
}

type EscalationOptionValue = 'approve' | 'reject'

export function EscalationPrompt({
  request,
  onApprove,
  onReject,
}: EscalationPromptProps): React.ReactNode {
  const [theme] = useTheme()

  const handleSelect = useCallback(
    (value: EscalationOptionValue) => {
      switch (value) {
        case 'approve':
          onApprove()
          break
        case 'reject':
          onReject()
          break
      }
    },
    [onApprove, onReject],
  )

  const options: PermissionPromptOption<EscalationOptionValue>[] = useMemo(
    () => [
      {
        label: 'Yes, grant temporary access',
        value: 'approve' as const,
      },
      {
        label: 'No, deny this request',
        value: 'reject' as const,
        feedbackConfig: { type: 'reject' as const },
      },
    ],
    [],
  )

  return (
    <PermissionDialog
      title="Escalation Request"
      color="warning"
      titleColor="warning"
    >
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text>
          <Text bold>Tool:</Text> {request.toolName}
          {request.ruleContent ? ` ({request.ruleContent})` : ''}
        </Text>
        <Text>
          <Text bold>Reason:</Text> {request.reason}
        </Text>
        {request.riskContext ? (
          <Text dimColor>
            <Text bold>Risk:</Text> {request.riskContext}
          </Text>
        ) : null}
        <Text dimColor>
          This grants temporary session-only access. Expires when the CLI exits.
        </Text>
      </Box>
      <PermissionPrompt
        options={options}
        onSelect={handleSelect}
        onCancel={onReject}
        question="Grant temporary elevated permission?"
      />
    </PermissionDialog>
  )
}