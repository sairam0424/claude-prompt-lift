import { expect, test } from 'claude-code/testing'
import { HINT } from '../hooks/register'

test('bare /prompt-master answers the hint and calls no model', async ($, on) => {
  const calls: unknown[] = []
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('model.complete', ($, e) => { calls.push(e); return { value: { isAnswered: false, reason: 'empty-reply' } } })
  const r = await $.command.run({ command: 'prompt-master', args: '' } as never)
  expect((r as { text?: string }).text).toBe(HINT)
  expect(calls).toHaveLength(0)
})
