import { create } from 'zustand'

export type Subgroup = 'all' | '1' | '2'

type UserState = {
  groupNumber: string
  studentCardNumber: string
  subgroup: Subgroup
  isOnboarded: boolean
  setOnboardingData: (payload: {
    groupNumber: string
    studentCardNumber: string
  }) => void
  setSubgroup: (subgroup: Subgroup) => void
  resetUser: () => void
}

const STORAGE_KEY = 'bsuir-nexus:user'

const defaultState: Pick<
  UserState,
  'groupNumber' | 'studentCardNumber' | 'subgroup' | 'isOnboarded'
> = {
  groupNumber: '',
  studentCardNumber: '',
  subgroup: 'all',
  isOnboarded: false,
}

const loadInitialState = () => {
  if (typeof window === 'undefined') {
    return defaultState
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return defaultState
    }

    const parsed = JSON.parse(raw) as Partial<UserState>

    return {
      ...defaultState,
      groupNumber: parsed.groupNumber ?? defaultState.groupNumber,
      studentCardNumber:
        parsed.studentCardNumber ?? defaultState.studentCardNumber,
      subgroup: parsed.subgroup ?? defaultState.subgroup,
      isOnboarded: parsed.isOnboarded ?? defaultState.isOnboarded,
    }
  } catch {
    return defaultState
  }
}

const persistState = (state: UserState) => {
  if (typeof window === 'undefined') {
    return
  }

  const payload: Omit<UserState, 'setOnboardingData' | 'setSubgroup' | 'resetUser'> =
    {
      groupNumber: state.groupNumber,
      studentCardNumber: state.studentCardNumber,
      subgroup: state.subgroup,
      isOnboarded: state.isOnboarded,
    }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // ignore persistence errors
  }
}

export const useUserStore = create<UserState>((set, get) => ({
  ...loadInitialState(),
  setOnboardingData: ({ groupNumber, studentCardNumber }) => {
    const next: UserState = {
      ...get(),
      groupNumber,
      studentCardNumber,
      isOnboarded: true,
    }
    persistState(next)
    set(next)
  },
  setSubgroup: (subgroup) => {
    const next: UserState = {
      ...get(),
      subgroup,
    }
    persistState(next)
    set(next)
  },
  resetUser: () => {
    const next: UserState = {
      ...defaultState,
      setOnboardingData: get().setOnboardingData,
      setSubgroup: get().setSubgroup,
      resetUser: get().resetUser,
    }
    persistState(next)
    set({
      groupNumber: defaultState.groupNumber,
      studentCardNumber: defaultState.studentCardNumber,
      subgroup: defaultState.subgroup,
      isOnboarded: defaultState.isOnboarded,
    })
  },
}))

