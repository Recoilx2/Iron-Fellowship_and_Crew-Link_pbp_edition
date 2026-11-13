import { Layout } from "components/shared/Layout";
import { getUser } from "api-calls/auth/getUser";
import { BASE_ROUTES, basePaths } from "routes";

import {
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
  redirect,
} from "react-router-dom";
import { ErrorRoute } from "components/shared/ErrorRoute";
import { CHARACTER_ROUTES, characterPaths } from "pages/Character/routes";
import {
  CAMPAIGN_ROUTES,
  campaignPaths,
  constructCampaignSheetPath,
} from "pages/Campaign/routes";
import { WORLD_ROUTES, worldPaths } from "pages/World/routes";
import { HeadProvider } from "providers/HeadProvider";
import { useListenToCharacters } from "stores/character/useListenToCharacters";
import { useListenToCampaigns } from "stores/campaign/useListenToCampaigns";
import { useListenToAuth } from "stores/auth/useListenToAuth";
import { useListenToWorlds } from "stores/world/useListenToWorlds";
import { useListenToOracleSettings } from "stores/settings/useListenToOracleSettings";
import { useListenToAccessibilitySettings } from "stores/accessibilitySettings/useListenToAccessibilitySettings";
import { useListenToHomebrew } from "stores/homebrew/useListenToHomebrew";
import { HOMEBREW_ROUTES, homebrewPaths } from "pages/Homebrew/routes";
import { useSyncDataswornTree } from "hooks/useSyncDataswornTree";
import { installStaleChunkReload } from "lib/staleChunkReload.lib";

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route
        path={"/"}
        element={
          <HeadProvider>
            <Layout />
          </HeadProvider>
        }
        errorElement={<ErrorRoute />}
        loader={async () => {
          // Wait for user to load in before displaying anything.
          // Actual logic for redirecting user based on authentication is present in Layout.tsx
          await getUser();
          return null;
        }}
        shouldRevalidate={() => false}
      >
        <Route index lazy={() => import("pages/Home")} />
        {/* PROTOTYPE (#6): throwaway chat screen variants, sample data only. */}
        <Route
          path={"/prototype/chat"}
          lazy={() => import("pages/Campaign/ChatPrototype")}
        />
        {/* Authenticated Pages */}
        <Route>
          <Route path={basePaths[BASE_ROUTES.CHARACTER]}>
            <Route
              index
              lazy={() => import("pages/Character/CharacterSelectPage")}
            />
            <Route
              path={characterPaths[CHARACTER_ROUTES.CREATE]}
              lazy={() => import("pages/Character/CharacterCreatePage")}
            />
            <Route
              path={characterPaths[CHARACTER_ROUTES.SHEET]}
              lazy={() => import("pages/Character/CharacterSheetPage")}
            />
          </Route>
          <Route path={basePaths[BASE_ROUTES.CAMPAIGN]}>
            <Route
              index
              lazy={() => import("pages/Campaign/CampaignSelectPage")}
            />
            <Route
              path={campaignPaths[CAMPAIGN_ROUTES.SHEET]}
              lazy={() => import("pages/Campaign/CampaignPage")}
            />
            <Route
              path={campaignPaths[CAMPAIGN_ROUTES.GM_SCREEN]}
              loader={({ params }) => {
                const campaignId = params.campaignId ?? "";
                return redirect(
                  constructCampaignSheetPath(campaignId, CAMPAIGN_ROUTES.SHEET)
                );
              }}
            />
            <Route
              path={campaignPaths[CAMPAIGN_ROUTES.JOIN]}
              lazy={() => import("pages/Campaign/CampaignJoinPage")}
            />
          </Route>
          <Route path={basePaths[BASE_ROUTES.WORLD]}>
            <Route index lazy={() => import("pages/World/WorldSelectPage")} />
            <Route
              path={worldPaths[WORLD_ROUTES.SHEET]}
              lazy={() => import("pages/World/WorldSheetPage")}
            />
          </Route>
          <Route path={basePaths[BASE_ROUTES.HOMEBREW]}>
            <Route
              index
              lazy={() => import("pages/Homebrew/HomebrewSelectPage")}
            />
            <Route
              path={homebrewPaths[HOMEBREW_ROUTES.EDITOR]}
              lazy={() => import("pages/Homebrew/HomebrewEditorPage")}
            />
            <Route
              path={homebrewPaths[HOMEBREW_ROUTES.EDITOR_JOIN]}
              lazy={() => import("pages/Homebrew/HomebrewEditorInvitationPage")}
            />
          </Route>
        </Route>
        {/* Unauthenticated Pages */}
        <Route>
          {/*
            Magic email links are the sign-in flow, sent through the
            deployment's mail server (see supabase/.env.example SMTP_*).
            The link returns to this site, where the session is picked up
            automatically; it must be opened in the same browser.
          */}
          <Route
            path={basePaths[BASE_ROUTES.LOGIN]}
            lazy={() => import("pages/Authentication/LoginPage")}
          />
          <Route
            path={basePaths[BASE_ROUTES.SIGNUP]}
            lazy={() => import("pages/Authentication/SignupPage")}
          />
        </Route>
      </Route>
      <Route
        path={
          basePaths[BASE_ROUTES.CHARACTER] +
          "/" +
          characterPaths[CHARACTER_ROUTES.CARD]
        }
        lazy={() => import("pages/Character/CharacterCardPage")}
      />
    </>
  )
);

installStaleChunkReload((callback) => {
  if (router.state.navigation.state === "idle") {
    callback();
    return;
  }
  const unsubscribe = router.subscribe((state) => {
    if (state.navigation.state === "idle") {
      unsubscribe();
      callback();
    }
  });
});

export function Router() {
  useListenToAuth();

  useListenToAccessibilitySettings();

  useListenToCharacters();
  useListenToCampaigns();
  useListenToWorlds();
  useListenToOracleSettings();
  useListenToHomebrew();

  useSyncDataswornTree();

  return <RouterProvider router={router} />;
}
