import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

// Un istante fisso: i test non dipendono dal giorno in cui girano.
const NOW = Date.parse('2026-11-07T20:00:00.000Z')
const WEEK_RESET = NOW + DAY + 5 * HOUR
const FIVE_RESET = NOW + 4 * HOUR + 29 * MINUTE

const BAND = {
  plugin: 'usage-meter',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 120,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const CONTEXT = { window: 1_000_000 }

function limits(weekly: number, fiveHour: number) {
  return [
    { kind: 'seven_day', percentUsed: weekly, resetsAt: new Date(WEEK_RESET).toISOString() },
    { kind: 'five_hour', percentUsed: fiveHour, resetsAt: new Date(FIVE_RESET).toISOString() },
  ]
}

/** Il motore sotto la mod: nei test non c'è, questi hook ne fanno le veci. */
function engine(on: On) {
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: CONTEXT, rateLimits: [] } }))
}

/** La data del reset come la scrive la mod, ricavata qui in modo indipendente. */
function expectedDate(ms: number): string {
  const at = new Date(ms)
  const day = at.toLocaleDateString('en-US', { weekday: 'long' })
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  return `${day} ${at.getDate()}, ${time}`
}

test('prima della prima lettura la riga lo dice, su terminale e desktop', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  engine(on)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const row = await ui.find({ type: 'Text' })
    expect(row?.text).toBe('Weekly limit n/d · in attesa della prima risposta')
    await ui.unmount()
  }
})

test('la riga mostra % settimanale, conto alla rovescia, data e 5h', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  engine(on)
  await $.session.measure({ context: CONTEXT, rateLimits: limits(13.4, 15), changed: ['rateLimits'] })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const week = await ui.find({ type: 'Text', text: /Weekly/ })
    expect(week?.text).toBe(`Weekly limit 13% · reset 1g 5h (${expectedDate(WEEK_RESET)})`)
    expect(week?.props.color).toBeUndefined()
    const hours = await ui.find({ type: 'Text', text: /5h \d/ })
    expect(hours?.text).toBe('   5h 15% · reset 4h 29m')
    await ui.unmount()
  }
})

test('il conto alla rovescia scende a ogni minuto', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.store(on)
  engine(on)
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.session.measure({ context: CONTEXT, rateLimits: limits(13, 15), changed: ['rateLimits'] })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await clock.advance(MINUTE)
  const hours = await ui.find({ type: 'Text', text: /5h \d/ })
  expect(hours?.text).toBe('   5h 15% · reset 4h 28m')
  await ui.unmount()
})

test('ambra da 80%, rosso da 95%', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  engine(on)
  await $.session.measure({ context: CONTEXT, rateLimits: limits(82, 96), changed: ['rateLimits'] })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /Weekly/ }))?.props.color).toBe('warning')
  expect((await ui.find({ type: 'Text', text: /5h \d/ }))?.props.color).toBe('error')
  await ui.unmount()
})

test('in una finestra stretta cadono prima il 5h, poi la data', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  engine(on)
  await $.session.measure({ context: CONTEXT, rateLimits: limits(13, 15), changed: ['rateLimits'] })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, bodyColumns: 40 } })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  expect(texts).toEqual(['Weekly limit 13% · reset 1g 5h'])
  await ui.unmount()
})

test('senza abbonamento la riga dice che il dato non arriva', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  engine(on)
  await $.session.measure({ context: CONTEXT, rateLimits: [], changed: ['context'] })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe(
    'Weekly limit n/d · non riportato (serve login con abbonamento)',
  )
  await ui.unmount()
})

test('un toast per soglia, e di nuovo solo dopo il reset della finestra', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on)
  engine(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const measure = (weekly: number) =>
    $.session.measure({ context: CONTEXT, rateLimits: limits(weekly, 1), changed: ['rateLimits'] })

  await measure(79)
  await measure(80)
  await measure(81)
  await measure(96)
  await measure(97)
  await measure(2)
  await measure(85)

  expect(toasts).toEqual([
    `Weekly limit 80% · reset 1g 5h (${expectedDate(WEEK_RESET)})`,
    `Weekly limit 96% · reset 1g 5h (${expectedDate(WEEK_RESET)})`,
    `Weekly limit 85% · reset 1g 5h (${expectedDate(WEEK_RESET)})`,
  ])
})

test('la soglia già segnalata da un\'altra sessione non si ripete', async ($, on) => {
  mock.clock(on, { now: NOW })
  mock.store(on, { 'alerted.seven_day': 80 })
  engine(on)
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  await $.session.measure({ context: CONTEXT, rateLimits: limits(83, 1), changed: ['rateLimits'] })
  expect(toasts).toEqual([])
})
