import { useThemeStore } from '../store/themeStore'

export const useTelegramTheme = () =>
  useThemeStore((state) => ({
    bgColor: state.bgColor,
    textColor: state.textColor,
    hintColor: state.hintColor,
    linkColor: state.linkColor,
    buttonColor: state.buttonColor,
    buttonTextColor: state.buttonTextColor,
    secondaryBgColor: state.secondaryBgColor,
    isDark: state.isDark,
  }))

