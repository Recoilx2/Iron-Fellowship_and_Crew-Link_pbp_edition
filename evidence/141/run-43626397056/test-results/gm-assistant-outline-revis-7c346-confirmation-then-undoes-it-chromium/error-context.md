# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: gm-assistant-outline-revision.spec.ts >> outline revisions >> a GM requests a revision, applies it behind a confirmation, then undoes it
- Location: e2e/gm-assistant-outline-revision.spec.ts:195:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

- Expected  - 0
+ Received  + 2

+
  E2E original plan 1794680913356 the bell rings twice
+

Call Log:
- Timeout 30000ms exceeded while waiting on the predicate
```

# Test source

```ts
  185 |     await page
  186 |       .getByRole("button", { name: "Assistant", exact: true })
  187 |       .click();
  188 |     await expect(page.getByText("GM assistant")).toBeVisible();
  189 |     await page.getByRole("tab", { name: "Outline" }).click();
  190 |     await expect(
  191 |       page.getByText("GM-only. Never shared with players.")
  192 |     ).toBeVisible();
  193 |   }
  194 | 
  195 |   test("a GM requests a revision, applies it behind a confirmation, then undoes it", async ({
  196 |     browser,
  197 |   }) => {
  198 |     const gmContext = await browser.newContext();
  199 |     try {
  200 |       const gmPage = await gmContext.newPage();
  201 |       await signInAs(gmPage, config, gm, campaignUrl(campaignId));
  202 |       await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();
  203 |       await openOutlineTab(gmPage);
  204 | 
  205 |       // Seed the outline by typing into the editor: the text travels
  206 |       // through the note server (the only writer its persisted store
  207 |       // trusts), unlike a direct row upsert, which the server's next
  208 |       // store would clobber with the empty document it already holds.
  209 |       const editor = gmPage.getByRole("textbox", { name: "Note text" });
  210 |       await expect(editor).toBeVisible();
  211 |       await editor.click();
  212 |       await gmPage.keyboard.type(ORIGINAL);
  213 |       await expect(editor).toContainText(ORIGINAL);
  214 | 
  215 |       // Wait until the typed text reaches the contents row before
  216 |       // revising, so the preview's "current" side is exact.
  217 |       await expect
  218 |         .poll(() => outlineContents(), { timeout: 30000 })
  219 |         .toBe(ORIGINAL);
  220 | 
  221 |       // An explicit revision action sends the instruction in
  222 |       // outline-revision mode; the reply previews both versions.
  223 |       await gmPage.getByRole("button", { name: "Revise outline" }).click();
  224 |       await gmPage
  225 |         .getByPlaceholder("How should the outline change?")
  226 |         .fill("Tighten act one.");
  227 |       await gmPage
  228 |         .getByRole("button", { name: "Request outline revision" })
  229 |         .click();
  230 |       await expect(
  231 |         gmPage.getByText("Proposed outline")
  232 |       ).toBeVisible();
  233 |       await expect(
  234 |         gmPage.getByLabel("Current outline text")
  235 |       ).toContainText(ORIGINAL);
  236 |       await expect(
  237 |         gmPage.getByLabel("Proposed outline text")
  238 |       ).toContainText(PROPOSED);
  239 | 
  240 |       // Apply needs confirmation; only confirming replaces the outline
  241 |       // and keeps the previous version. The open editor moves onto the
  242 |       // replacement at once.
  243 |       await gmPage.getByRole("button", { name: "Apply to outline" }).click();
  244 |       await expect(
  245 |         gmPage.getByText("Replace the outline?")
  246 |       ).toBeVisible();
  247 |       expect(await outlineContents()).toBe(ORIGINAL);
  248 |       await gmPage.getByRole("button", { name: "Confirm replace" }).click();
  249 |       await expect(gmPage.getByText("Applied.")).toBeVisible();
  250 |       // The row settles once the remounted editor's sync reaches the
  251 |       // server: a stale persisted store can briefly flip it back first.
  252 |       await expect
  253 |         .poll(() => outlineContents(), { timeout: 30000 })
  254 |         .toBe(PROPOSED);
  255 |       await expect(
  256 |         gmPage.getByRole("textbox", { name: "Note text" })
  257 |       ).toContainText(PROPOSED);
  258 |       const { data: versions, error: versionsError } = await gm.client
  259 |         .from("assistant_outline_versions")
  260 |         .select("content")
  261 |         .eq("campaign_id", campaignId);
  262 |       expect(versionsError).toBeNull();
  263 |       expect(
  264 |         ((versions ?? []) as Array<{ content: string }>).map(
  265 |           (row) => row.content
  266 |         )
  267 |       ).toEqual([ORIGINAL]);
  268 | 
  269 |       // The Outline tab's Undo restores the previous version, and the
  270 |       // editor moves back onto it at once. Scope to the tab header's
  271 |       // button: the applied preview carries its own Undo.
  272 |       await gmPage
  273 |         .getByRole("button", {
  274 |           name: "Undo outline revision",
  275 |           description: "Restore the previous outline version",
  276 |         })
  277 |         .click();
  278 |       await expect(
  279 |         gmPage.getByRole("textbox", { name: "Note text" })
  280 |       ).toContainText(ORIGINAL);
  281 |       // Same settling as after Apply: the remount disconnect lets a stale
  282 |       // store flip the row back briefly before the new sync lands.
  283 |       await expect
  284 |         .poll(() => outlineContents(), { timeout: 30000 })
> 285 |         .toBe(ORIGINAL);
      |          ^ Error: expect(received).toBe(expected) // Object.is equality
  286 |       const { data: kept, error: keptError } = await gm.client
  287 |         .from("assistant_outline_versions")
  288 |         .select("id")
  289 |         .eq("campaign_id", campaignId);
  290 |       expect(keptError).toBeNull();
  291 |       expect(kept ?? []).toEqual([]);
  292 | 
  293 |       // The reopened editor reads the restored text.
  294 |       await gmPage.reload();
  295 |       await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();
  296 |       await openOutlineTab(gmPage);
  297 |       await expect(
  298 |         gmPage.getByRole("textbox", { name: "Note text" })
  299 |       ).toContainText(ORIGINAL);
  300 |     } finally {
  301 |       await gmContext.close().catch(() => undefined);
  302 |     }
  303 |   });
  304 | });
  305 | 
```