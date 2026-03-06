import { create } from 'zustand'

export type TelegramThemeParams = {
  bg_color?: string
  text_color?: string
  hint_color?: string
  link_color?: string
  button_color?: string
  button_text_color?: string
  secondary_bg_color?: string
}

export type ColorScheme = 'light' | 'dark' | 'unknown' | undefined

type ThemeState = {
  bgColor: string
  textColor: string
  hintColor: string
  linkColor: string
  buttonColor: string
  buttonTextColor: string
  secondaryBgColor: string
  isDark: boolean
  setThemeFromTelegram: (
    params?: TelegramThemeParams,
    colorScheme?: ColorScheme,
  ) => void
}

const lightDefaults = {
  bgColor: '#ffffff',
  textColor: '#000000',
  hintColor: '#6b7280',
  linkColor: '#0ea5e9',
  buttonColor: '#0ea5e9',
  buttonTextColor: '#ffffff',
  secondaryBgColor: '#f3f4f6',
}

const darkDefaults = {
  bgColor: '#17212b',
  textColor: '#ffffff',
  hintColor: '#9ca3af',
  linkColor: '#38bdf8',
  buttonColor: '#1d9bf0',
  buttonTextColor: '#ffffff',
  secondaryBgColor: '#1f2933',
}

const buildThemeState = (
  params?: TelegramThemeParams,
  colorScheme?: ColorScheme,
) => {
  const isDark = colorScheme === 'dark'
  const base = isDark ? darkDefaults : lightDefaults

  return {
    bgColor: params?.bg_color ?? base.bgColor,
    textColor: params?.text_color ?? base.textColor,
    hintColor: params?.hint_color ?? base.hintColor,
    linkColor: params?.link_color ?? base.linkColor,
    buttonColor: params?.button_color ?? base.buttonColor,
    buttonTextColor:
      params?.button_text_color ?? base.buttonTextColor,
    secondaryBgColor:
      params?.secondary_bg_color ?? base.secondaryBgColor,
    isDark,
  }
}

const isSameThemeState = (
  current: Omit<ThemeState, 'setThemeFromTelegram'>,
  next: ReturnType<typeof buildThemeState>,
) =>
  current.bgColor === next.bgColor &&
  current.textColor === next.textColor &&
  current.hintColor === next.hintColor &&
  current.linkColor === next.linkColor &&
  current.buttonColor === next.buttonColor &&
  current.buttonTextColor === next.buttonTextColor &&
  current.secondaryBgColor === next.secondaryBgColor &&
  current.isDark === next.isDark

export const useThemeStore = create<ThemeState>((set) => ({
  ...lightDefaults,
  isDark: false,
  setThemeFromTelegram: (params, colorScheme) => {
    set((state) => {
      const nextState = buildThemeState(params, colorScheme)

      return isSameThemeState(state, nextState)
        ? state
        : nextState
    })
  },
}))

