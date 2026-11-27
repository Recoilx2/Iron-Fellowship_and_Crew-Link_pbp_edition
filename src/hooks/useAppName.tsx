import { getAppBranding } from "config/branding.config";

export function useAppName() {
  return getAppBranding().appName;
}
