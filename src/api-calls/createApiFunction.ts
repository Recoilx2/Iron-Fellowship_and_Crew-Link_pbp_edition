import { createErrorSnackbar } from "providers/SnackbarProvider/useSnackbar";
import { mintErrorReference } from "functions/errorReference";

export type ApiFunction<Params, ReturnType> = (
  params: Params
) => Promise<ReturnType>;

export function createApiFunction<Params, Result>(
  apiFunction: ApiFunction<Params, Result>,
  friendlyErrorMessage: string
): ApiFunction<Params, Result> {
  return (params: Params) =>
    new Promise((resolve, reject) => {
      apiFunction(params)
        .then(resolve)
        .catch((e) => {
          // Short reference code per failure (story 38): the user sees only
          // the generic message plus this code, while details stay in logs.
          const referenceCode = mintErrorReference();
          console.error(`API call failed (ref: ${referenceCode})`, e);
          try {
            createErrorSnackbar(
              `${friendlyErrorMessage} (ref: ${referenceCode})`
            );
          } catch {
            // No SnackbarProvider mounted (e.g. vitest): the toast cannot be
            // shown, but the caller must still get the rejection below.
          }
          reject(e);
        });
    });
}
