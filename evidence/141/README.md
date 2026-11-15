# Evidence for #141 (chat momentum burn e2e flake)

CI e2e artifacts and failed-job logs from the failing ticket/133 runs listed in #141,
downloaded 2026-11-15. The Playwright HTML report bundle is left out (only the viewer);
open a trace with `npx playwright show-trace <trace.zip>`.

| Run | Burn spec failed | Outline-revision spec failed |
|---|---|---|
| 43619823108 | no | yes |
| 43621272608 | yes | yes |
| 43625634809 | yes | yes |
| 43626397056 | yes | yes |
| 43627104337 | yes | no (`gh run view --log-failed` returned no log) |

The outline-revision failures were #133 work in progress, fixed before #140 merged.
They are kept for context only; #141 is about the burn spec.
