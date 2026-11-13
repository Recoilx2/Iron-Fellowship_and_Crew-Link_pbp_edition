/**
 * Leaf module for the Homebrew page route names. It imports nothing, so the
 * app route table (`routes`) can read these paths without forming the
 * `routes` <-> `pages/Homebrew/routes` cycle that used to crash module
 * evaluation when the Homebrew page routes loaded first.
 */
export enum HOMEBREW_ROUTES {
  SELECT,
  EDITOR,
  EDITOR_JOIN,
}

export const homebrewPaths: { [key in HOMEBREW_ROUTES]: string } = {
  [HOMEBREW_ROUTES.SELECT]: "",
  [HOMEBREW_ROUTES.EDITOR]: ":homebrewId",
  [HOMEBREW_ROUTES.EDITOR_JOIN]: "invite/:editorInviteKey",
};
