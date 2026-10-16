import type { Register } from 'claude-code'

export const HINT = 'prompt-master: type /prompt-master <your prompt>, press ctrl+x b, or click Enhance'

export const register: Register = (on, options) => {
  on('session.start', async ($, e) => {
    await $.command.register({
      name: 'prompt-master',
      description: 'Enhance the prompt from the project instructions and skills',
      argumentHint: '<text> | undo | model <id> | status | diff | probe'
    })
    return { next: e }
  })

  on('command.run', { command: 'prompt-master' }, async ($, e) => {
    if (e.args.trim() === '') {
      return { text: HINT }
    }
    return { text: 'prompt-master: not built yet' }
  })
}
