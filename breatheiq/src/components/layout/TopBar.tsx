import clsx from 'clsx'
import { Menu, Moon, Presentation, Sun, X } from 'lucide-react'
import { APP } from '../../config'
import { PAGES, go, useRoute } from '../../lib/router'
import { useUi } from '../../lib/ui'
import { useSim } from '../../sim/engine'
import { useCloud } from '../../cloud/store'
import { SCENARIOS, type ScenarioId } from '../../sim/scenarios'

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
        <path d="M5 11h14a4 4 0 1 0-4-4M5 17h19a4 4 0 1 1-4 4M5 23h8" fill="none" stroke="var(--accent)" strokeWidth="2.6" strokeLinecap="round" />
      </svg>
      <span className="text-[0.9375rem] font-semibold tracking-[-0.02em]">{APP.name}</span>
    </span>
  )
}

function ScenarioSelect({ className }: { className?: string }) {
  const id = useSim((s) => s.world.scenario.id)
  const setScenario = useSim((s) => s.setScenario)
  return (
    <label className={clsx('relative', className)}>
      <span className="sr-only">Scenario</span>
      <select
        value={id}
        onChange={(e) => setScenario(Number(e.target.value) as ScenarioId)}
        className="micro h-8 w-full cursor-pointer appearance-none rounded-card border border-line-strong bg-surface pr-7 pl-2.5 text-ink hover:border-accent/60"
        data-tour="scenario"
      >
        {SCENARIOS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.id} · {s.short}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-[0.6rem] text-muted" aria-hidden>▼</span>
    </label>
  )
}

/** Where frames are coming from right now: AWS IoT Core, the local engine, or an Arduino on a cable. */
export function StatusPill() {
  const status = useCloud((s) => s.status)
  const region = useCloud((s) => s.config?.region)
  const latency = useCloud((s) => s.latencyS)
  const serial = useSim((s) => s.source === 'serial')
  const live = status === 'live'
  const label = serial
    ? 'Arduino · Web Serial'
    : live
      ? `AWS IoT Core · ${region} · ${latency === null ? '—' : `${latency.toFixed(1)} s`}`
      : 'Local engine'
  const title = serial
    ? 'Frames come from the Arduino over USB.'
    : live
      ? 'Frames arrive from AWS IoT Core. The figure is the delay from the coach to this page.'
      : 'The in-browser engine is running the cabin. It hands over to AWS IoT Core as soon as frames arrive.'
  return (
    <span className="micro inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-[0.625rem] whitespace-nowrap text-muted" title={title}>
      <span className={clsx('h-1.5 w-1.5 rounded-full', live || serial ? 'bg-ok' : 'bg-muted')} aria-hidden />
      {label}
    </span>
  )
}

export function TopBar() {
  const route = useRoute()
  const { theme, setTheme, setPresenter, presenter, menuOpen, setMenu } = useUi()

  const nav = (cls: string, onPick?: () => void) =>
    PAGES.map((p) => (
      <a
        key={p.id}
        href={`#/${p.id}`}
        onClick={(e) => {
          e.preventDefault()
          go(p.id)
          onPick?.()
        }}
        aria-current={route === p.id ? 'page' : undefined}
        className={clsx(cls, route === p.id ? 'text-accent' : 'text-muted hover:text-ink')}
      >
        {p.label}
      </a>
    ))

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur-md no-print">
      <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
        <a href="#/live" onClick={(e) => { e.preventDefault(); go('live') }} aria-label={`${APP.name} home`}>
          <Logo />
        </a>
        <nav aria-label="Primary" className="ml-4 hidden items-center gap-5 xl:flex">
          {nav('text-[0.8125rem] font-medium transition-colors')}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden sm:inline-flex">
            <StatusPill />
          </span>
          <ScenarioSelect className="hidden md:block" />
          <button
            type="button"
            onClick={() => setPresenter(!presenter)}
            className="hidden h-8 items-center gap-2 rounded-card border border-line-strong px-2.5 text-[0.8125rem] text-muted hover:border-accent/60 hover:text-ink md:inline-flex"
            aria-keyshortcuts="P Control+K Meta+K"
            data-tour="presenter"
          >
            <Presentation size={14} aria-hidden />
            Presenter
            <kbd className="rounded-[3px] border border-line px-1 font-mono text-[0.625rem]">⌘K</kbd>
          </button>
          <button
            type="button"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-card border border-line-strong text-muted hover:text-ink"
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
          <button
            type="button"
            onClick={() => setMenu(!menuOpen)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-card border border-line-strong text-muted hover:text-ink xl:hidden"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
          >
            {menuOpen ? <X size={16} /> : <Menu size={16} />}
          </button>
        </div>
      </div>
      {menuOpen && (
        <div id="mobile-nav" className="border-t border-line bg-bg px-4 pt-2 pb-4 xl:hidden">
          <nav aria-label="Primary mobile" className="grid grid-cols-2 gap-1 sm:grid-cols-4">
            {nav('rounded-card px-3 py-2.5 text-sm font-medium hover:bg-surface-2', () => setMenu(false))}
          </nav>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusPill />
            <ScenarioSelect className="min-w-40 flex-1" />
            <button
              type="button"
              onClick={() => { setPresenter(true); setMenu(false) }}
              className="inline-flex h-8 items-center gap-2 rounded-card border border-line-strong px-2.5 text-[0.8125rem] text-muted"
            >
              <Presentation size={14} aria-hidden /> Presenter
            </button>
          </div>
        </div>
      )}
    </header>
  )
}
