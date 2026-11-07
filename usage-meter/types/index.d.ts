/** One rate-limit window as the engine reports it (`seven_day`, `five_hour`). */
export type LimitWindow = { kind: string; percentUsed: number; resetsAt?: string }

/** The last reading: when it arrived and the windows the API reported. */
export type Reading = { measuredAt: number; windows: LimitWindow[] }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': {
      /** null until the first `session.measure` of the session. */
      reading: Shaped<Reading | null>
      /** Clock for the reset countdown, rewritten every minute. */
      now: number
    }
  }
}
