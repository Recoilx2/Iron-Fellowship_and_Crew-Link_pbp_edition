import React from "react";
import ReactDOM from "react-dom/client";
import { AppProviders } from "providers/AppProviders";
import { Router } from "Router";
import "./styles.css";
import "./polyfills";

import "@fontsource-variable/rubik";
import "@fontsource/bebas-neue";
import { Dice } from "components/shared/Dice";
import { markDiceUnavailable } from "stores/appState/rollers/rollDice";
import { bootstrapRules } from "data/bootstrapRules";
import { logError } from "functions/errorReference";

// Without WebGL the 3D dice cannot start. Rolls then skip them at once
// rather than waiting for them to time out.
Promise.resolve()
  .then(() => Dice.init())
  .catch(() => markDiceUnavailable());

function render() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppProviders>
        <Router />
      </AppProviders>
    </React.StrictMode>,
  );
}

// Mounted rules packages are fetched before the first render, so branding,
// mechanics and the base-rules defaults already reflect the active ruleset
// when any consumer reads them. A bad mount is logged and falls back to the
// configured game rather than blocking the site.
bootstrapRules()
  .catch((e) => logError("bootstrapRules", e))
  .finally(render);
