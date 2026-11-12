import { BASE_ROUTES, basePaths } from "routes";

export { HOMEBREW_ROUTES, homebrewPaths } from "pages/Homebrew/homebrewRoutes";

export function constructHomebrewEditorPath(homebrewId: string) {
  return `${basePaths[BASE_ROUTES.HOMEBREW]}/${homebrewId}`;
}

export function constructHomebrewEditorInvitePath(inviteKey: string) {
  return `${basePaths[BASE_ROUTES.HOMEBREW]}/invite/${inviteKey}`;
}
