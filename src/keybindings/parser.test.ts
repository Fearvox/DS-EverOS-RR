import { describe, test, expect } from 'bun:test'
import {
  parseKeystroke,
  parseChord,
  keystrokeToString,
  chordToString,
  keystrokeToDisplayString,
  chordToDisplayString,
  parseBindings,
} from './parser.js'

describe('parseKeystroke', () => {
  test('parses simple key', () => {
    const ks = parseKeystroke('k')
    expect(ks.key).toBe('k')
    expect(ks.ctrl).toBe(false)
    expect(ks.alt).toBe(false)
    expect(ks.shift).toBe(false)
  })

  test('parses ctrl modifier', () => {
    const ks = parseKeystroke('ctrl+c')
    expect(ks.ctrl).toBe(true)
    expect(ks.key).toBe('c')
  })

  test('parses control alias', () => {
    expect(parseKeystroke('control+c').ctrl).toBe(true)
  })

  test('parses alt modifier', () => {
    expect(parseKeystroke('alt+x').alt).toBe(true)
  })

  test('parses opt/option aliases', () => {
    expect(parseKeystroke('opt+x').alt).toBe(true)
    expect(parseKeystroke('option+x').alt).toBe(true)
  })

  test('parses shift modifier', () => {
    expect(parseKeystroke('shift+a').shift).toBe(true)
  })

  test('parses cmd/command/super/win as super', () => {
    expect(parseKeystroke('cmd+k').super).toBe(true)
    expect(parseKeystroke('command+k').super).toBe(true)
    expect(parseKeystroke('super+k').super).toBe(true)
    expect(parseKeystroke('win+k').super).toBe(true)
  })

  test('parses multiple modifiers', () => {
    const ks = parseKeystroke('ctrl+shift+k')
    expect(ks.ctrl).toBe(true)
    expect(ks.shift).toBe(true)
    expect(ks.key).toBe('k')
  })

  test('normalizes esc to escape', () => {
    expect(parseKeystroke('esc').key).toBe('escape')
  })

  test('normalizes return to enter', () => {
    expect(parseKeystroke('return').key).toBe('enter')
  })

  test('normalizes space to space char', () => {
    expect(parseKeystroke('space').key).toBe(' ')
  })

  test('normalizes arrow symbols', () => {
    expect(parseKeystroke('↑').key).toBe('up')
    expect(parseKeystroke('↓').key).toBe('down')
    expect(parseKeystroke('←').key).toBe('left')
    expect(parseKeystroke('→').key).toBe('right')
  })
})

describe('parseChord', () => {
  test('parses single keystroke', () => {
    const chord = parseChord('ctrl+k')
    expect(chord).toHaveLength(1)
    expect(chord[0].ctrl).toBe(true)
    expect(chord[0].key).toBe('k')
  })

  test('parses multi-keystroke chord', () => {
    const chord = parseChord('ctrl+k ctrl+s')
    expect(chord).toHaveLength(2)
    expect(chord[0].key).toBe('k')
    expect(chord[1].key).toBe('s')
  })

  test('handles lone space as space key', () => {
    const chord = parseChord(' ')
    expect(chord).toHaveLength(1)
    expect(chord[0].key).toBe(' ')
  })
})

describe('keystrokeToString', () => {
  test('formats simple key', () => {
    expect(keystrokeToString(parseKeystroke('k'))).toBe('k')
  })

  test('formats ctrl+key', () => {
    expect(keystrokeToString(parseKeystroke('ctrl+c'))).toBe('ctrl+c')
  })

  test('formats multiple modifiers in order', () => {
    expect(keystrokeToString(parseKeystroke('shift+ctrl+k'))).toBe(
      'ctrl+shift+k',
    )
  })

  test('uses display names for special keys', () => {
    expect(keystrokeToString(parseKeystroke('esc'))).toBe('Esc')
  })
})

describe('chordToString', () => {
  test('formats multi-key chord', () => {
    const result = chordToString(parseChord('ctrl+k ctrl+s'))
    expect(result).toBe('ctrl+k ctrl+s')
  })
})

describe('keystrokeToDisplayString', () => {
  test('uses opt on macOS', () => {
    const ks = parseKeystroke('alt+x')
    expect(keystrokeToDisplayString(ks, 'macos')).toBe('opt+x')
  })

  test('uses alt on linux', () => {
    const ks = parseKeystroke('alt+x')
    expect(keystrokeToDisplayString(ks, 'linux')).toBe('alt+x')
  })

  test('uses cmd on macOS for super', () => {
    const ks = parseKeystroke('cmd+k')
    expect(keystrokeToDisplayString(ks, 'macos')).toBe('cmd+k')
  })

  test('uses super on linux for super', () => {
    const ks = parseKeystroke('cmd+k')
    expect(keystrokeToDisplayString(ks, 'linux')).toBe('super+k')
  })
})

describe('parseBindings', () => {
  test('parses binding blocks', () => {
    const blocks = [
      {
        context: 'input' as const,
        bindings: {
          'ctrl+c': 'cancel',
          'ctrl+d': 'exit',
        },
      },
    ]
    const parsed = parseBindings(blocks)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].action).toBe('cancel')
    expect(parsed[0].context).toBe('input')
    expect(parsed[1].action).toBe('exit')
  })

  test('handles multiple blocks', () => {
    const blocks = [
      { context: 'input' as const, bindings: { 'ctrl+c': 'cancel' } },
      { context: 'dialog' as const, bindings: { 'enter': 'confirm' } },
    ]
    const parsed = parseBindings(blocks)
    expect(parsed).toHaveLength(2)
    expect(parsed[0].context).toBe('input')
    expect(parsed[1].context).toBe('dialog')
  })
})
