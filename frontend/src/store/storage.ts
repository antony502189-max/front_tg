import { createJSONStorage, type StateStorage } from 'zustand/middleware'

const noopStorage: StateStorage = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
}

export const createBrowserJsonStorage = <T>() =>
  createJSONStorage<T>(() =>
    typeof window === 'undefined' ? noopStorage : window.localStorage,
  )
