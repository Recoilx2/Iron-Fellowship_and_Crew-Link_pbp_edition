# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: gm-assistant-outline-revision.spec.ts >> outline revisions >> a GM requests a revision, applies it behind a confirmation, then undoes it
- Location: e2e/gm-assistant-outline-revision.spec.ts:195:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Applied.')
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByText('Applied.') with timeout 15000ms
  - waiting for getByText('Applied.')

```

```yaml
- link "Skip to Content":
  - /url: "#main-content"
- link "Iron Fellowship":
  - /url: /
  - img "Iron Fellowship"
- navigation:
  - link "Characters":
    - /url: /characters
  - link "Campaigns":
    - /url: /campaigns
  - link "Worlds":
    - /url: /worlds
  - link "Homebrew":
    - /url: /homebrew
- button "Other Apps and Resources"
- button "User Settings"
- main:
  - heading "E2E Revision 1794677617613" [level=1]
  - button "Invite Players"
  - button "Campaign Settings"
  - button "Assistant"
  - paragraph: GM assistant
  - combobox "Model":
    - option "live-chat-model" [selected]
    - option "live-other-model"
    - option "live-third-model"
  - button "Close assistant"
  - text: ~58 / 4096 tokens
  - button "Edit context": Edit
  - progressbar "Context size"
  - tablist "Assistant sections":
    - tab "Chat"
    - tab "Context"
    - tab "Outline" [selected]
  - text: GM-only. Never shared with players.
  - button "Revise outline"
  - button "Undo outline revision" [disabled]: Undo
  - heading "Current outline" [level=6]
  - paragraph: E2E original plan 1794677617611 the bell rings twice
  - heading "Proposed outline" [level=6]
  - paragraph: "E2E revised plan: the bell cracks in act one."
  - button "Apply to outline"
  - button "Discard outline revision": Discard
  - button "Skip to note text"
  - text: Text Type
  - combobox "Text Type Normal Text": Normal Text
  - group:
    - button "Bold"
    - button "Italic"
    - button "Strikethrough"
  - group:
    - button "Bulleted List"
    - button "Numbered List"
    - button "Outdent" [disabled]
    - button "Indent" [disabled]
    - button "Horizontal Rule"
    - button "Quote"
  - text: Saving...
  - textbox "Note text":
    - heading [level=1]
    - paragraph: "E2E revised plan: the bell cracks in act one."
  - tablist:
    - tab "Moves" [selected]
    - tab "Oracles"
  - textbox "Filter Moves"
  - listitem:
    - button "Adventure Moves"
  - listitem:
    - button "Relationship Moves"
  - listitem:
    - button "Combat Moves"
  - listitem:
    - button "Suffer Moves"
  - listitem:
    - button "Quest Moves"
  - listitem:
    - button "Fate Moves"
  - tablist "Campaign sections":
    - tab "Chat" [selected]
    - tab "Characters"
    - tab "Tracks"
    - tab "My notes"
    - tab "World"
    - tab "Locations"
    - tab "NPCs"
    - tab "Lore"
  - tabpanel:
    - list:
      - listitem:
        - text: In character
        - button "New In character channel"
      - button "# In character"
      - listitem:
        - text: Out of character
        - button "New Out of character channel"
      - button "# Out of character"
      - listitem:
        - text: Private
        - button "New Private channel"
      - listitem: People
      - button "E e2e-revision-player direct message":
        - text: E e2e-revision-player
        - paragraph: direct message
      - button "E e2e-revision-gm you" [disabled]:
        - text: E e2e-revision-gm
        - paragraph: you
      - button "Show archived":
        - paragraph: Show archived
    - paragraph: "# In character in character"
    - button "Rename"
    - button "Archive" [disabled]
    - paragraph: Nothing here yet.
    - paragraph: Posting as e2e-revision-gm (GM)
    - button "Attach images"
    - 'textbox "Post in # In character"'
    - button "Send" [disabled]
    - button "Hide my rolls from players" [pressed]
    - text: "Roll:"
    - button "Ask the Oracle"
    - button "Oracles"
    - button "Dice"
    - tablist "Chat side screens":
      - tab "Character" [selected]
      - tab "Tracks"
      - tab "World"
      - tab "My notes"
    - heading "Characters" [level=2]
    - button "Add a Character"
    - heading "Players" [level=2]
    - button "Invite Players"
    - text: E
    - heading "e2e-revision-player" [level=3]
    - text: E
    - heading "e2e-revision-gm" [level=3]
- list
```

# Test source

```ts
  149 |       await Promise.all(
  150 |         people.map((person) =>
  151 |           deletePerson(config, person.userId).catch(() => undefined)
  152 |         )
  153 |       );
  154 |       people = [];
  155 |     }
  156 |   });
  157 | 
  158 |   async function outlineId(): Promise<string> {
  159 |     const { data, error } = await gm.client
  160 |       .from("campaign_notes")
  161 |       .select("id")
  162 |       .eq("campaign_id", campaignId)
  163 |       .eq("kind", "outline");
  164 |     expect(error).toBeNull();
  165 |     const id = (data?.[0] as { id?: unknown } | undefined)?.id;
  166 |     expect(typeof id).toBe("string");
  167 |     return id as string;
  168 |   }
  169 | 
  170 |   async function outlineContents(): Promise<string | null> {
  171 |     const id = await outlineId();
  172 |     const { data, error } = await gm.client
  173 |       .from("campaign_note_contents")
  174 |       .select("content")
  175 |       .eq("note_id", id);
  176 |     expect(error).toBeNull();
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
> 249 |       await expect(gmPage.getByText("Applied.")).toBeVisible();
      |                                                  ^ Error: expect(locator).toBeVisible() failed
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
  266 |       // editor moves back onto it at once.
  267 |       await gmPage.getByRole("button", { name: "Undo outline revision" }).click();
  268 |       expect(await outlineContents()).toBe(ORIGINAL);
  269 |       await expect(
  270 |         gmPage.getByRole("textbox", { name: "Note text" })
  271 |       ).toContainText(ORIGINAL);
  272 |       const { data: kept, error: keptError } = await gm.client
  273 |         .from("assistant_outline_versions")
  274 |         .select("id")
  275 |         .eq("campaign_id", campaignId);
  276 |       expect(keptError).toBeNull();
  277 |       expect(kept ?? []).toEqual([]);
  278 | 
  279 |       // The reopened editor reads the restored text.
  280 |       await gmPage.reload();
  281 |       await expect(gmPage.getByRole("tab", { name: "Chat" })).toBeVisible();
  282 |       await openOutlineTab(gmPage);
  283 |       await expect(
  284 |         gmPage.getByRole("textbox", { name: "Note text" })
  285 |       ).toContainText(ORIGINAL);
  286 |     } finally {
  287 |       await gmContext.close().catch(() => undefined);
  288 |     }
  289 |   });
  290 | });
  291 | 
```