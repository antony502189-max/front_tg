import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { UserProfile, UserRole } from '../types/user'
import { createBrowserJsonStorage } from './storage'

export type Subgroup = 'all' | '1' | '2'

type UserData = {
  role: UserRole | null
  groupNumber: string
  studentCardNumber: string
  iisLogin: string
  hasIisPassword: boolean
  employeeId: string
  urlId: string
  fullName: string
  position: string
  department: string
  avatarUrl: string
  subgroup: Subgroup
  isOnboarded: boolean
}

type UserState = UserData & {
  isProfileBootstrapped: boolean
  applyUserProfile: (profile: UserProfile) => void
  markProfileBootstrapped: () => void
  setSubgroup: (subgroup: Subgroup) => void
  resetUser: () => void
}

const STORAGE_KEY = 'bsuir-nexus:user'

const defaultState: UserData = {
  role: null,
  groupNumber: '',
  studentCardNumber: '',
  iisLogin: '',
  hasIisPassword: false,
  employeeId: '',
  urlId: '',
  fullName: '',
  position: '',
  department: '',
  avatarUrl: '',
  subgroup: 'all',
  isOnboarded: false,
}

const normalizeSubgroup = (value: unknown): Subgroup =>
  value === '1' || value === '2' || value === 'all'
    ? value
    : 'all'

const sanitizePersistedUser = (
  persisted: Partial<UserData> | null | undefined,
): UserData => {
  const role =
    persisted?.role === 'student' || persisted?.role === 'teacher'
      ? persisted.role
      : typeof persisted?.groupNumber === 'string' ||
          typeof persisted?.studentCardNumber === 'string'
        ? 'student'
        : null

  return {
    role,
    groupNumber:
      typeof persisted?.groupNumber === 'string'
        ? persisted.groupNumber
        : defaultState.groupNumber,
    studentCardNumber:
      typeof persisted?.studentCardNumber === 'string'
        ? persisted.studentCardNumber
        : typeof persisted?.iisLogin === 'string'
          ? persisted.iisLogin
        : defaultState.studentCardNumber,
    iisLogin:
      typeof persisted?.iisLogin === 'string'
        ? persisted.iisLogin
        : defaultState.iisLogin,
    hasIisPassword:
      typeof persisted?.hasIisPassword === 'boolean'
        ? persisted.hasIisPassword
        : defaultState.hasIisPassword,
    employeeId:
      typeof persisted?.employeeId === 'string'
        ? persisted.employeeId
        : defaultState.employeeId,
    urlId:
      typeof persisted?.urlId === 'string'
        ? persisted.urlId
        : defaultState.urlId,
    fullName:
      typeof persisted?.fullName === 'string'
        ? persisted.fullName
        : defaultState.fullName,
    position:
      typeof persisted?.position === 'string'
        ? persisted.position
        : defaultState.position,
    department:
      typeof persisted?.department === 'string'
        ? persisted.department
        : defaultState.department,
    avatarUrl:
      typeof persisted?.avatarUrl === 'string'
        ? persisted.avatarUrl
        : defaultState.avatarUrl,
    subgroup: normalizeSubgroup(persisted?.subgroup),
    isOnboarded:
      typeof persisted?.isOnboarded === 'boolean'
        ? persisted.isOnboarded
        : defaultState.isOnboarded,
  }
}

const mapProfileToState = (profile: UserProfile): UserData => ({
  role: profile.role,
  groupNumber: profile.groupNumber?.trim() ?? '',
  studentCardNumber:
    profile.studentCardNumber?.trim() ?? profile.iisLogin?.trim() ?? '',
  iisLogin: profile.iisLogin?.trim() ?? '',
  hasIisPassword: profile.hasIisPassword === true,
  employeeId: profile.employeeId?.trim() ?? '',
  urlId: profile.urlId?.trim() ?? '',
  fullName: profile.fullName?.trim() ?? '',
  position: profile.position?.trim() ?? '',
  department: profile.department?.trim() ?? '',
  avatarUrl: profile.avatarUrl?.trim() ?? '',
  subgroup: normalizeSubgroup(profile.subgroup),
  isOnboarded: true,
})

export const useUserStore = create<UserState>()(
  persist(
    (set) => ({
      ...defaultState,
      isProfileBootstrapped: false,
      applyUserProfile: (profile) => {
        set({
          ...mapProfileToState(profile),
          isProfileBootstrapped: true,
        })
      },
      markProfileBootstrapped: () => {
        set({ isProfileBootstrapped: true })
      },
      setSubgroup: (subgroup) => {
        set({ subgroup: normalizeSubgroup(subgroup) })
      },
      resetUser: () => {
        set({
          ...defaultState,
          isProfileBootstrapped: true,
        })
      },
    }),
    {
      name: STORAGE_KEY,
      storage: createBrowserJsonStorage<UserData>(),
      partialize: (state) => ({
        role: state.role,
        groupNumber: state.groupNumber,
        studentCardNumber: state.studentCardNumber,
        iisLogin: state.iisLogin,
        hasIisPassword: state.hasIisPassword,
        employeeId: state.employeeId,
        urlId: state.urlId,
        fullName: state.fullName,
        position: state.position,
        department: state.department,
        avatarUrl: state.avatarUrl,
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
