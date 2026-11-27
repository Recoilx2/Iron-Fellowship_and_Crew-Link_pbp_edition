import { useContext } from "react";
import { ThemeContext } from "./ThemeContext";
import { themes } from "./themes";
import { getAppBranding } from "config/branding.config";

export function useThemeValue(
  key: "background" | "iconPath" | "emptyStateImage"
) {
  const { theme: themeKey } = useContext(ThemeContext);
  const defaultTheme = getAppBranding().theme;
  const theme = themes[themeKey] ?? themes[defaultTheme];

  if (key === "background") {
    return theme.background;
  } else if (key === "iconPath") {
    return theme.iconPath;
  } else if (key === "emptyStateImage") {
    return theme.emptyStateImage;
  }
}
