import { lazy, Suspense, useEffect } from 'react'
import { MotionConfig } from 'framer-motion'
import { useRoute } from './lib/router'
import { useUi } from './lib/ui'
import { useSim } from './sim/engine'
import type { ScenarioId } from './sim/scenarios'
import { TopBar } from './components/layout/TopBar'
import { AlarmLayer, Footer, SimStrip } from './components/layout/Chrome'
import { PresenterPanel, Tour } from './components/layout/Presenter'
import { AskButton } from './components/ask/AskButton'

// the assistant and its Knowledge Base documents load as their own chunk
const AskDrawer = lazy(() => import('./components/ask/AskDrawer').then((m) => ({ default: m.AskDrawer })))
import { LivePage } from './pages/Live'
import { FleetPage } from './pages/Fleet'
import { ExposurePage } from './pages/Exposure'
import { MlLabPage } from './pages/MlLab'
import { ControlsPage } from './pages/Controls'
import { SystemPage } from './pages/System'
import { PlaybookPage } from './pages/Playbook'

const PAGE = {
  live: LivePage,
  fleet: FleetPage,
  exposure: ExposurePage,
  ml: MlLabPage,
  controls: ControlsPage,
  system: SystemPage,
  playbook: PlaybookPage,
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState()
      const sim = useSim.getState()
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        ui.setPresenter(!ui.presenter)
        return
      }
      if (e.key === 'Escape') {
        ui.setPresenter(false)
        ui.setTour(null)
        ui.setMenu(false)
        ui.setAsk(false)
        return
      }
      const t = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]'))) return
      if (/^[1-7]$/.test(e.key)) {
        sim.setScenario(Number(e.key) as ScenarioId, sim.world.scenario.sustain && e.key !== '1')
      } else if (e.key.toLowerCase() === 'p') {
        ui.setPresenter(!ui.presenter)
      } else if (e.key === ' ' && !(t && t.closest('button, a, [role="switch"], [role="tab"]'))) {
        e.preventDefault()
        sim.setRunning(!sim.running)
      } else if (e.key.toLowerCase() === 'b') {
        sim.setBadDay(!sim.world.badDay.active)
      } else if (e.key.toLowerCase() === 'g') {
        ui.setTour(0)
      } else if (e.key.toLowerCase() === 'j') {
        e.preventDefault()
        ui.setAsk(!ui.askOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

export default function App() {
  const route = useRoute()
  useShortcuts()
  const Page = PAGE[route]
  return (
    <MotionConfig reducedMotion="user">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80] focus:rounded-card focus:bg-accent focus:px-3 focus:py-2 focus:text-accent-ink">
        Skip to content
      </a>
      <TopBar />
      <SimStrip />
      <AlarmLayer />
      <main id="main" className="mx-auto max-w-[1440px] px-4 sm:px-6">
        <Page />
      </main>
      <Footer />
      <PresenterPanel />
      <AskButton />
      <Suspense fallback={null}>
        <AskDrawer />
      </Suspense>
      <Tour />
    </MotionConfig>
  )
}
