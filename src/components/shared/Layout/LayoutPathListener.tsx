import { useContinueUrl } from "hooks/useContinueUrl";
import { useEffect } from "react";
import { matchPath, useLocation } from "react-router-dom";
import {
  BASE_ROUTES,
  basePaths,
  onlyUnauthenticatedPaths,
  openPaths,
} from "routes";
import { AUTH_STATE } from "stores/auth/auth.slice.type";
import { useStore } from "stores/store";

export function LayoutPathListener() {
  const { pathname } = useLocation();
  const state = useStore((store) => store.auth.status);
  const { redirectWithContinueUrl, navigateToContinueURL } = useContinueUrl();

  useEffect(() => {
    const doesOpenPathMatch = openPaths.some((path) => {
      return !!matchPath(path, pathname);
    });
    if (!doesOpenPathMatch && state === AUTH_STATE.UNAUTHENTICATED) {
      redirectWithContinueUrl(basePaths[BASE_ROUTES.LOGIN], pathname);
    } else if (
      onlyUnauthenticatedPaths.includes(pathname) &&
      state === AUTH_STATE.AUTHENTICATED
    ) {
      navigateToContinueURL(basePaths[BASE_ROUTES.CHARACTER]);
    }
  }, [pathname, state, navigateToContinueURL, redirectWithContinueUrl]);

  return null;
}
