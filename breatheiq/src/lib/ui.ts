import { create } from 'zustand'
import { storage } from './storage'

type Theme = 'dark' | 'light'

interface UiState {
  theme: Theme
  presenter: boolean
  tourStep: number | null
  menuOpen: boolean
  askOpen: boolean
  setTheme: (t: Theme) => void
  setPresenter: (v: boolean) => void
  setTour: (s: number | null) => void
  setMenu: (v: boolean) => void
  setAsk: (v: boolean) => void
}

const initialTheme = (): Theme => {
  const t = storage.get<string>('breatheiq.theme', 'dark')
  return t === 'light' ? 'light' : 'dark'
}

export const useUi = create<UiState>((set) => ({
  theme: initialTheme(),
  presenter: false,
  tourStep: null,
  menuOpen: false,
  askOpen: false,
  setTheme: (theme) => {
    document.documentElement.setAttribute('data-theme', theme)
    try {
      window.localStorage.setItem('breatheiq.theme', theme)
    } catch {
      /* storage blocked */
    }
    set({ theme })
  },
  setPresenter: (presenter) => set({ presenter }),
  setTour: (tourStep) => set({ tourStep }),
  setMenu: (menuOpen) => set({ menuOpen }),
  setAsk: (askOpen) => set({ askOpen }),
}))
