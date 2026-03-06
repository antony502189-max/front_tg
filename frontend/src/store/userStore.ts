import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { createBrowserJsonStorage } from './storage'

export type Subgroup = 'all' | '1' | '2'

type UserData = {
  groupNumber: string
  studentCardNumber: string
  subgroup: Subgroup
  isOnboarded: boolean
}

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

const defaultState: UserData = {
  groupNumber: '',
  studentCardNumber: '',
  subgroup: 'all',
  isOnboarded: false,
}

const sanitizePersistedUser = (
  persisted: Partial<UserData> | null | undefined,
): UserData => ({
  groupNumber:
    typeof persisted?.groupNumber === 'string'
      ? persisted.groupNumber
      : defaultState.groupNumber,
  studentCardNumber:
    typeof persisted?.studentCardNumber === 'string'
      ? persisted.studentCardNumber
      : defaultState.studentCardNumber,
  subgroup:
    persisted?.subgroup === '1' ||
    persisted?.subgroup === '2' ||
    persisted?.subgroup === 'all'
      ? persisted.subgroup
      : defaultState.subgroup,
  isOnboarded:
    typeof persisted?.isOnboarded === 'boolean'
      ? persisted.isOnboarded
      : defaultState.isOnboarded,
})

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      ...defaultState,
      setOnboardingData: ({ groupNumber, studentCardNumber }) => {
        set({
          groupNumber: groupNumber.trim(),
          studentCardNumber: studentCardNumber.trim(),
          isOnboarded: true,
        })
      },
      setSubgroup: (subgroup) => {
        set({ subgroup })
      },
      resetUser: () => {
        set(defaultState)
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createBrowserJsonStorage<UserData>(),
      partialize: (state) => ({
        groupNumber: state.groupNumber,
        studentCardNumber: state.studentCardNumber,
        subgroup: state.subgroup,
        isOnboarded: state.isOnboarded,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedUser(persistedState as Partial<UserData>),
      }),
    },
  ),
)

