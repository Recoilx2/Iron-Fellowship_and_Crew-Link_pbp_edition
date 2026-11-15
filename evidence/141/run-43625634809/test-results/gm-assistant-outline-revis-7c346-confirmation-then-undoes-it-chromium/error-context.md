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

- Expected  - 1
+ Received  + 2

- E2E original plan 1794680479698 the bell rings twice
+
+ E2E revised plan: the bell cracks in act one.
```

# Test source

```ts
  177 |     const content = (data?.[0] as { content?: unknown } | undefined)?.content;
  178 |     return typeof content === "string" ? outlineBytesToText(content) : null;
  179 |   }
  180 | 
  181 |   async function openOutlineTab(page: Parameters<typeof signInAs>[0]) {
  182 |     await expect(
  183 |       page.getByRole("button", { name: "Assistant", exact: true })
  184 |     ).toBeVisible();
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
  250 |       expect(await outlineContents()).toBe(PROPOSED);
  251 |       await expect(
  252 |         gmPage.getByRole("textbox", { name: "Note text" })
  253 |       ).toContainText(PROPOSED);
  254 |       const { data: versions, error: versionsError } = await gm.client
  255 |         .from("assistant_outline_versions")
  256 |         .select("content")
  257 |         .eq("campaign_id", campaignId);
  258 |       expect(versionsError).toBeNull();
  259 |       expect(
  260 |         ((versions ?? []) as Array<{ content: string }>).map(
  261 |           (row) => row.content
  262 |         )
  263 |       ).toEqual([ORIGINAL]);
  264 | 
  265 |       // The Outline tab's Undo restores the previous version, and the
  266 |       // editor moves back onto it at once. Scope to the tab header's
  267 |       // button: the applied preview carries its own Undo.
  268 |       await gmPage
  269 |         .getByRole("button", {
  270 |           name: "Undo outline revision",
  271 |           description: "Restore the previous outline version",
  272 |         })
  273 |         .click();
  274 |       await expect(
  275 |         gmPage.getByRole("textbox", { name: "Note text" })
  276 |       ).toContainText(ORIGINAL);
> 277 |       expect(await outlineContents()).toBe(ORIGINAL);
      |                                       ^ Error: expect(received).toBe(expected) // Object.is equality
  278 |       const { data: kept, error: keptError } = await gm.client
  279 |         .from("assistant_outline_versions")
  280 |         .select("id")
  281 |         .eq("campaign_id", campaignId);
  282 |       expect(keptError).toBeNull();
  283 |       expect(kept ?? []).toEqual([]);
  284 | 
  285 |       // The reopened editor reads the restored text.
  286 |       await gmPage.reload();
  287 |       await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();
  288 |       await openOutlineTab(gmPage);
  289 |       await expect(
  290 |         gmPage.getByRole("textbox", { name: "Note text" })
  291 |       ).toContainText(ORIGINAL);
  292 |     } finally {
  293 |       await gmContext.close().catch(() => undefined);
  294 |     }
  295 |   });
  296 | });
  297 | 
```