// The pause chip's voice (#222): tone is decided by the monitor's cause, not
// by the wording of its reason, and the alarmed voice is the default for an
// engine that does not say.
import { describe, expect, it } from 'vitest'
import { pauseVoice } from '../src/drift.ts'

describe('pauseVoice', () => {
  it('a dirty tree is the warn voice, with the remedy in the consequence', () => {
    const voice = pauseVoice({ codeCause: 'dirty' })
    expect(voice.tone).toBe('warn')
    expect(voice.consequence).toMatch(/No run in this deployment dispatches/)
    expect(voice.consequence).toMatch(/committed or discarded/)
  })

  it('the topology family stays red, and says what ends it', () => {
    for (const codeCause of ['off-default-branch', 'detached', 'non-fast-forward', 'in-progress'] as const) {
      const voice = pauseVoice({ codeCause })
      expect(voice.tone).toBe('bad')
      expect(voice.consequence).toMatch(/clean and back on the default branch/)
    }
  })

  it('an engine too old to report a cause is treated as alarming, not ordinary', () => {
    expect(pauseVoice({}).tone).toBe('bad')
  })
})
