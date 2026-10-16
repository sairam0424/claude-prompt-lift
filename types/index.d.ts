export type LastUsage = {
  model: string
  input: number
  cached: number
  written: number
  output: number
  usd: number
  attempts: string[]
  why: string
  addedWords: number
  skills: number
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-master': {
      phase: 'idle' | 'running' | 'done'
      original: string | null
      enhanced: string | null
      isUndone: boolean
      model: string
      runningModel: string
      lastUsage: LastUsage | null
      blockHash: string
      staticChars: number
      requestId: number
      noCacheStreak: number
      sessionPresses: number
      sessionUsd: number
    }
  }
}
