import { useSyncExternalStore } from 'react'

export const PAGES = [
  { id: 'live', label: 'Live', num: '01' },
  { id: 'fleet', label: 'Fleet', num: '02' },
  { id: 'exposure', label: 'Exposure', num: '03' },
  { id: 'ml', label: 'ML Lab', num: '04' },
  { id: 'controls', label: 'Controls', num: '05' },
  { id: 'system', label: 'System', num: '06' },
  { id: 'playbook', label: 'Playbook', num: '07' },
] as const
export type PageId = (typeof PAGES)[number]['id']

const isPage = (v: string): v is PageId => PAGES.some((p) => p.id === v)

function read(): PageId {
  const h = window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0]
  return isPage(h) ? h : 'live'
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}

export const useRoute = () => useSyncExternalStore(subscribe, read, () => 'live' as PageId)

export function go(page: PageId) {
  if (read() !== page) {
    window.location.hash = `/${page}`
  }
  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior })
}
