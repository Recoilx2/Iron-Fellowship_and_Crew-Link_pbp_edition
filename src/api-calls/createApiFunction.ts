import { createErrorSnackbar } from "providers/SnackbarProvider";

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
          console.error(e);
          createErrorSnackbar(friendlyErrorMessage);
          reject(e);
        });
    });
}
