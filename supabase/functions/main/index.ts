// Placeholder main service for the Edge Runtime container.
//
// Later tickets add real server functions under supabase/functions/<name>/.
// Until then every /functions/v1/* request gets a 404 with a stable,
// machine-readable body so operators can tell "no functions yet" apart from
// "gateway or runtime down".
//
// The GM assistant's AI proxy (spec #10) and any other server code will live
// here; the gateway already routes /functions/v1/ to this container.

Deno.serve((_req: Request): Response => {
  return Response.json(
    { code: "FUNCTIONS_NOT_CONFIGURED", message: "No server functions are deployed yet" },
    { status: 404 },
  );
});
