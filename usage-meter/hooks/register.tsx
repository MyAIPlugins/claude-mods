import { atom, read, update } from 'claude-code'
import type { Color, EngineInterface, Register } from 'claude-code'

import type { LimitWindow, Reading } from '../types'

// Soglie in % intere, le stesse mostrate nella riga: ambra da WARN, rosso da
// CRITICAL. Un toast per soglia per finestra, ricordato tra sessioni in $.store.
const WARN = 80
const CRITICAL = 95
const ALERT_LEVELS = [WARN, CRITICAL] as const

// Ogni quanto si ridisegna il conto alla rovescia del reset.
const TICK_MS = 60_000

// Le finestre mostrate, nell'ordine della riga. La prima porta anche la data.
const WINDOWS = [
  { kind: 'seven_day', label: 'Weekly limit', withDate: true },
  { kind: 'five_hour', label: '5h', withDate: false },
] as const

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

const TEXT = {
  waiting: 'n/d · in attesa della prima risposta',
  missing: 'n/d · non riportato (serve login con abbonamento)',
  resetNow: 'reset ora',
  separator: '   ',
} as const

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// Cambia il tag se cambia la forma di Reading: un valore salvato da una
// versione precedente sopravvive al reload e va scartato.
const reading = atom({ plugin: 'usage-meter', key: 'reading' } as const, null, {
  shape: 'reading-1',
})
// Letto solo per ridisegnare la riga a ogni tick; l'ora vera è $.clock.now().
const tick = atom({ plugin: 'usage-meter', key: 'now' } as const, 0)

function percentOf(window: LimitWindow): number {
  return Math.round(window.percentUsed)
}

function colorOf(percent: number): Color | undefined {
  if (percent >= CRITICAL) return 'error'
  if (percent >= WARN) return 'warning'
  return undefined
}

function parseReset(resetsAt: string): number {
  const ms = Date.parse(resetsAt)
  if (Number.isNaN(ms)) {
    throw new Error(`usage-meter: resetsAt non è una data ISO: "${resetsAt}"`)
  }
  return ms
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** "reset 1g 5h", "reset 4h 29m", "reset 12m". */
function countdown(resetMs: number, nowMs: number): string {
  const left = resetMs - nowMs
  if (left < MINUTE) return TEXT.resetNow

  const days = Math.floor(left / DAY)
  const hours = Math.floor((left % DAY) / HOUR)
  const minutes = Math.floor((left % HOUR) / MINUTE)
  if (days > 0) return `reset ${days}g ${hours}h`
  if (hours > 0) return `reset ${hours}h ${minutes}m`
  return `reset ${minutes}m`
}

/** "Monday 9, 11:30", nell'ora locale. */
function resetDate(resetMs: number): string {
  const at = new Date(resetMs)
  const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`
  return `${WEEKDAYS[at.getDay()]} ${at.getDate()}, ${time}`
}

/** "Weekly limit 13% · reset 1g 5h (Monday 9, 11:30)". */
function describe(
  label: string,
  window: LimitWindow,
  nowMs: number,
  withDate: boolean,
): string {
  const head = `${label} ${percentOf(window)}%`
  if (window.resetsAt === undefined) return head

  const resetMs = parseReset(window.resetsAt)
  const date = withDate ? ` (${resetDate(resetMs)})` : ''
  return `${head} · ${countdown(resetMs, nowMs)}${date}`
}

function toReading(windows: readonly LimitWindow[], measuredAt: number): Reading {
  // resetsAt resta fuori quando manca: lo stato accetta solo JSON.
  const copy = windows.map(({ kind, percentUsed, resetsAt }) =>
    resetsAt === undefined ? { kind, percentUsed } : { kind, percentUsed, resetsAt },
  )
  return { measuredAt, windows: copy }
}

/**
 * Un toast quando una finestra supera una soglia non ancora segnalata.
 * In una finestra la % cresce soltanto: una % sotto la soglia salvata vuol
 * dire che la finestra si è azzerata, e la soglia salvata riparte da 0.
 */
async function alertOnThresholds(
  $: EngineInterface,
  windows: readonly LimitWindow[],
  nowMs: number,
): Promise<void> {
  for (const shown of WINDOWS) {
    const window = windows.find(one => one.kind === shown.kind)
    if (window === undefined) continue

    const key = `alerted.${shown.kind}`
    const stored = await $.store.get(key)
    if (stored !== undefined && typeof stored !== 'number') {
      throw new Error(`usage-meter: $.store "${key}" non è un numero: ${JSON.stringify(stored)}`)
    }

    const percent = percentOf(window)
    const alerted = stored !== undefined && percent >= stored ? stored : 0
    const level = ALERT_LEVELS.filter(one => percent >= one).at(-1) ?? 0

    if (level > alerted) {
      $.ui.toast(describe(shown.label, window, nowMs, shown.withDate))
      await $.store.set(key, level)
    } else if (alerted !== stored) {
      await $.store.set(key, alerted)
    }
  }
}

/** Scrive l'ora nel tick: chi disegna la riga la ridisegna. */
async function stamp($: EngineInterface): Promise<void> {
  const nowMs = await $.clock.now()
  await update($, tick, () => nowMs)
}

export const register: Register = on => {
  let timer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    const result = await next(e)

    timer?.cancel()
    await stamp($)
    timer = $.clock.every(TICK_MS, () => {
      stamp($).catch((error: unknown) => {
        $.ui.log(`usage-meter: tick fallito: ${String(error)}`)
      })
    })

    // Una sessione ripresa ha già una lettura: la riga parte da quella.
    const usage = await $.session.usage()
    if (usage.rateLimits.length > 0) {
      const nowMs = await $.clock.now()
      await update($, reading, () => toReading(usage.rateLimits, nowMs))
    }

    return result
  })

  on('session.end', async ($, e, next) => {
    timer?.cancel()
    timer = undefined
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)

    const nowMs = await $.clock.now()
    await update($, reading, () => toReading(e.rateLimits, nowMs))
    if (e.changed.includes('rateLimits')) {
      await alertOnThresholds($, e.rateLimits, nowMs)
    }

    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    await read($, tick)
    const current = await read($, reading)
    const nowMs = await $.clock.now()
    const [weekly, fiveHour] = WINDOWS

    if (current === null) {
      return <Text dimColor>{`${weekly.label} ${TEXT.waiting}`}</Text>
    }

    const week = current.windows.find(one => one.kind === weekly.kind)
    if (week === undefined) {
      return <Text dimColor>{`${weekly.label} ${TEXT.missing}`}</Text>
    }

    const columns = e.props.bodyColumns
    const full = describe(weekly.label, week, nowMs, true)
    const weekText = full.length <= columns ? full : describe(weekly.label, week, nowMs, false)

    const hours = current.windows.find(one => one.kind === fiveHour.kind)
    const hoursText =
      hours === undefined ? undefined : `${TEXT.separator}${describe(fiveHour.label, hours, nowMs, false)}`
    const fits = hoursText !== undefined && weekText.length + hoursText.length <= columns
    const hoursColor = hours === undefined ? undefined : colorOf(percentOf(hours))

    return (
      <Box>
        <Text color={colorOf(percentOf(week))} wrap="truncate-end">
          {weekText}
        </Text>
        {fits && (
          <Text color={hoursColor} dimColor={hoursColor === undefined}>
            {hoursText}
          </Text>
        )}
      </Box>
    )
  })
}
