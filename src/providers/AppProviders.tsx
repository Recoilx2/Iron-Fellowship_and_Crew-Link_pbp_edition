import { PropsWithChildren } from "react";
import { ThemeProvider } from "./ThemeProvider";
import { SnackbarProvider } from "./SnackbarProvider";
import { ConfirmProvider } from "material-ui-confirm";

export function AppProviders(props: PropsWithChildren) {
  const { children } = props;
  return (
    <ThemeProvider>
      <ConfirmProvider
        defaultOptions={{ cancellationButtonProps: { color: "inherit" } }}
      >
        <SnackbarProvider>
          <>{children}</>
        </SnackbarProvider>
      </ConfirmProvider>
    </ThemeProvider>
  );
}
