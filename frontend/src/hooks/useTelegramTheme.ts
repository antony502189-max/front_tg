import { useThemeStore } from '../store/themeStore'
import { useShallow } from 'zustand/react/shallow'

export const useTelegramTheme = () =>
  useThemeStore(
    useShallow((state) => ({
      bgColor: state.bgColor,
      textColor: state.textColor,
      hintColor: state.hintColor,
      linkColor: state.linkColor,
      buttonColor: state.buttonColor,
      buttonTextColor: state.buttonTextColor,
      secondaryBgColor: state.secondaryBgColor,
      isDark: state.isDark,
    })),
  )

