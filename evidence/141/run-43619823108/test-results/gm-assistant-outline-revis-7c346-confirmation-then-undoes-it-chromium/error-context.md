# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: gm-assistant-outline-revision.spec.ts >> outline revisions >> a GM requests a revision, applies it behind a confirmation, then undoes it
- Location: e2e/gm-assistant-outline-revision.spec.ts:165:3

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: "E2E original plan 1794676641684 the bell rings twice"
Received: ""

Call Log:
- Timeout 30000ms exceeded while waiting on the predicate
```

# Test source

```ts
  89  |     target = detectComposeProject(envFile);
  90  |     fake = await startFakeAssistantUpstream(FAKE_PORT);
  91  |     // The model returns a marked complete replacement, the form the
  92  |     // client pulls the proposal out of.
  93  |     fake.chunks = [
  94  |       "<<<OUTLINE-BEGIN>>>\n",
  95  |       `${PROPOSED}\n`,
  96  |       "<<<OUTLINE-END>>>",
  97  |     ];
  98  |     recreateFunctionsContainer(target, {
  99  |       GM_ASSISTANT_ENDPOINT: fake.containerUrl,
  100 |       GM_ASSISTANT_API_KEY: TEST_API_KEY,
  101 |       GM_ASSISTANT_ALLOWED_MODELS: "",
  102 |     });
  103 |     await waitForFunctionsReady(functionsBase);
  104 |     configured = true;
  105 |   });
  106 | 
  107 |   test.afterAll(async () => {
  108 |     try {
  109 |       if (target && configured) {
  110 |         recreateFunctionsContainer(target, {});
  111 |         await waitForFunctionsReady(functionsBase).catch(() => undefined);
  112 |       }
  113 |     } finally {
  114 |       await fake?.close().catch(() => undefined);
  115 |       fake = null;
  116 |       if (campaignId) {
  117 |         await deleteCampaignAsAdmin(config, campaignId).catch(() => undefined);
  118 |       }
  119 |       await Promise.all(
  120 |         people.map((person) =>
  121 |           deletePerson(config, person.userId).catch(() => undefined)
  122 |         )
  123 |       );
  124 |       people = [];
  125 |     }
  126 |   });
  127 | 
  128 |   async function outlineId(): Promise<string> {
  129 |     const { data, error } = await gm.client
  130 |       .from("campaign_notes")
  131 |       .select("id")
  132 |       .eq("campaign_id", campaignId)
  133 |       .eq("kind", "outline");
  134 |     expect(error).toBeNull();
  135 |     const id = (data?.[0] as { id?: unknown } | undefined)?.id;
  136 |     expect(typeof id).toBe("string");
  137 |     return id as string;
  138 |   }
  139 | 
  140 |   async function outlineContents(): Promise<string | null> {
  141 |     const id = await outlineId();
  142 |     const { data, error } = await gm.client
  143 |       .from("campaign_note_contents")
  144 |       .select("content")
  145 |       .eq("note_id", id);
  146 |     expect(error).toBeNull();
  147 |     const content = (data?.[0] as { content?: unknown } | undefined)?.content;
  148 |     return typeof content === "string" ? yjsToText(content) : null;
  149 |   }
  150 | 
  151 |   async function openOutlineTab(page: Parameters<typeof signInAs>[0]) {
  152 |     await expect(
  153 |       page.getByRole("button", { name: "Assistant", exact: true })
  154 |     ).toBeVisible();
  155 |     await page
  156 |       .getByRole("button", { name: "Assistant", exact: true })
  157 |       .click();
  158 |     await expect(page.getByText("GM assistant")).toBeVisible();
  159 |     await page.getByRole("tab", { name: "Outline" }).click();
  160 |     await expect(
  161 |       page.getByText("GM-only. Never shared with players.")
  162 |     ).toBeVisible();
  163 |   }
  164 | 
  165 |   test("a GM requests a revision, applies it behind a confirmation, then undoes it", async ({
  166 |     browser,
  167 |   }) => {
  168 |     const gmContext = await browser.newContext();
  169 |     try {
  170 |       const gmPage = await gmContext.newPage();
  171 |       await signInAs(gmPage, config, gm, campaignUrl(campaignId));
  172 |       await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();
  173 |       await openOutlineTab(gmPage);
  174 | 
  175 |       // Seed the outline by typing into the editor: the text travels
  176 |       // through the note server (the only writer its persisted store
  177 |       // trusts), unlike a direct row upsert, which the server's next
  178 |       // store would clobber with the empty document it already holds.
  179 |       const editor = gmPage.getByRole("textbox", { name: "Note text" });
  180 |       await expect(editor).toBeVisible();
  181 |       await editor.click();
  182 |       await gmPage.keyboard.type(ORIGINAL);
  183 |       await expect(editor).toContainText(ORIGINAL);
  184 | 
  185 |       // Wait until the typed text reaches the contents row before
  186 |       // revising, so the preview's "current" side is exact.
  187 |       await expect
  188 |         .poll(() => outlineContents(), { timeout: 30000 })
> 189 |         .toBe(ORIGINAL);
      |          ^ Error: expect(received).toBe(expected) // Object.is equality
  190 | 
  191 |       // An explicit revision action sends the instruction in
  192 |       // outline-revision mode; the reply previews both versions.
  193 |       await gmPage.getByRole("button", { name: "Revise outline" }).click();
  194 |       await gmPage
  195 |         .getByPlaceholder("How should the outline change?")
  196 |         .fill("Tighten act one.");
  197 |       await gmPage
  198 |         .getByRole("button", { name: "Request outline revision" })
  199 |         .click();
  200 |       await expect(
  201 |         gmPage.getByText("Proposed outline")
  202 |       ).toBeVisible();
  203 |       await expect(
  204 |         gmPage.getByLabel("Current outline text")
  205 |       ).toContainText(ORIGINAL);
  206 |       await expect(
  207 |         gmPage.getByLabel("Proposed outline text")
  208 |       ).toContainText(PROPOSED);
  209 | 
  210 |       // Apply needs confirmation; only confirming replaces the outline
  211 |       // and keeps the previous version. The open editor moves onto the
  212 |       // replacement at once.
  213 |       await gmPage.getByRole("button", { name: "Apply to outline" }).click();
  214 |       await expect(
  215 |         gmPage.getByText("Replace the outline?")
  216 |       ).toBeVisible();
  217 |       expect(await outlineContents()).toBe(ORIGINAL);
  218 |       await gmPage.getByRole("button", { name: "Confirm replace" }).click();
  219 |       await expect(gmPage.getByText("Applied.")).toBeVisible();
  220 |       expect(await outlineContents()).toBe(PROPOSED);
  221 |       await expect(
  222 |         gmPage.getByRole("textbox", { name: "Note text" })
  223 |       ).toContainText(PROPOSED);
  224 |       const { data: versions, error: versionsError } = await gm.client
  225 |         .from("assistant_outline_versions")
  226 |         .select("content")
  227 |         .eq("campaign_id", campaignId);
  228 |       expect(versionsError).toBeNull();
  229 |       expect(
  230 |         ((versions ?? []) as Array<{ content: string }>).map(
  231 |           (row) => row.content
  232 |         )
  233 |       ).toEqual([ORIGINAL]);
  234 | 
  235 |       // The Outline tab's Undo restores the previous version, and the
  236 |       // editor moves back onto it at once.
  237 |       await gmPage.getByRole("button", { name: "Undo outline revision" }).click();
  238 |       expect(await outlineContents()).toBe(ORIGINAL);
  239 |       await expect(
  240 |         gmPage.getByRole("textbox", { name: "Note text" })
  241 |       ).toContainText(ORIGINAL);
  242 |       const { data: kept, error: keptError } = await gm.client
  243 |         .from("assistant_outline_versions")
  244 |         .select("id")
  245 |         .eq("campaign_id", campaignId);
  246 |       expect(keptError).toBeNull();
  247 |       expect(kept ?? []).toEqual([]);
  248 | 
  249 |       // The reopened editor reads the restored text.
  250 |       await gmPage.reload();
  251 |       await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();
  252 |       await openOutlineTab(gmPage);
  253 |       await expect(
  254 |         gmPage.getByRole("textbox", { name: "Note text" })
  255 |       ).toContainText(ORIGINAL);
  256 |     } finally {
  257 |       await gmContext.close().catch(() => undefined);
  258 |     }
  259 |   });
  260 | });
  261 | 
```