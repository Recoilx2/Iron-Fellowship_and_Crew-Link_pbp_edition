# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-sheet-rolls.spec.ts >> sheet rolls land in the starting IC channel >> a custom dice roll from the sheet posts as the character
- Location: e2e/chat-sheet-rolls.spec.ts:72:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: /^1d6: \d+ \(\d+\)$/ })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: /^1d6: \d+ \(\d+\)$/ }) with timeout 15000ms
  - waiting for getByRole('button', { name: /^1d6: \d+ \(\d+\)$/ })

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
  - link "Rules":
    - /url: /rules
- button "Other Apps and Resources"
- button "User Settings"
- main:
  - heading "E2E Sheet Rolls 1795818889804" [level=1]
  - button "Invite Players"
  - button "Campaign Settings"
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
      - button "Search posts"
      - listitem: In character
      - button "# In character"
      - listitem: Out of character
      - button "# Out of character"
      - listitem: People
      - button "E e2e-gm GM · direct message":
        - text: E e2e-gm
        - paragraph: GM · direct message
      - button "E e2e-player you" [disabled]:
        - text: E e2e-player
        - paragraph: you
      - button "Show archived":
        - paragraph: Show archived
    - paragraph: "# In character in character"
    - 'checkbox "Email notifications for # In character"'
    - text: Emails
    - paragraph: Failed to load posts.
    - paragraph: Posting as E2E Kira
    - button "Attach images"
    - 'textbox "Post in # In character"'
    - button "Send" [disabled]
    - text: "Roll:"
    - button "Move"
    - button "Stat"
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
    - heading "Your characters" [level=3]
    - heading "E" [level=5]
    - heading "E2E Kira" [level=3]
    - paragraph: e2e-player
    - paragraph: Active
    - button "Out of Combat"
    - text: edge 0 heart 0 iron 0 shadow 0 wits 0 health +5 spirit +5 Momentum +2
    - button "Assets"
    - button "XP and Bonds"
    - 'button "Retire: E2E Kira"': Retire
    - 'button "Remove Character: E2E Kira"': Remove Character
    - 'link "Open Sheet: E2E Kira"':
      - /url: /characters/3427a0da-f0bf-4d6b-9e2c-6ab3c1be3be3
      - text: Open Sheet
    - heading "Players" [level=2]
    - button "Invite Players"
    - text: E
    - heading "e2e-gm" [level=3]
    - text: E
    - heading "e2e-player" [level=3]
- list
```

# Test source

```ts
  13  | } from "./fixtures";
  14  | 
  15  | /**
  16  |  * Rolls made elsewhere in a campaign land in chat (spec #9, ticket #30):
  17  |  * a player rolls custom dice from their character sheet, and the roll
  18  |  * posts to the campaign's starting IC channel as their character, where
  19  |  * the GM sees it live. The sheet's own roll log stays for solo
  20  |  * characters; here the sheet belongs to a campaign, so its rolls post.
  21  |  *
  22  |  * Nothing here may skip: setup throws without a running stack copy, so a
  23  |  * misconfigured run fails instead of passing silently.
  24  |  */
  25  | 
  26  | test.describe("sheet rolls land in the starting IC channel", () => {
  27  |   let config: StackConfig;
  28  |   let campaignId: string;
  29  |   const campaignName = `E2E Sheet Rolls ${Date.now()}`;
  30  |   let gm: E2EPerson;
  31  |   let player: E2EPerson;
  32  |   let people: E2EPerson[] = [];
  33  |   let kiraId: string;
  34  | 
  35  |   test.beforeAll(async () => {
  36  |     config = stackConfig();
  37  |     gm = await createPerson(config, "e2e-gm");
  38  |     player = await createPerson(config, "e2e-player");
  39  |     people = [gm, player];
  40  |     // Co-op makes the founder a GM, which the campaign needs.
  41  |     campaignId = await createCampaignAs(gm, campaignName, "co-op");
  42  |     await joinCampaignAs(player, campaignId);
  43  |     // The player's one campaign character: the starting IC channel posts
  44  |     // sheet rolls as them. The id is generated here so the insert needs no
  45  |     // RETURNING clause: the characters SELECT policy re-queries its own
  46  |     // table, which cannot see a just-inserted row in the same statement, so
  47  |     // insert-then-select always fails RLS (#69).
  48  |     kiraId = crypto.randomUUID();
  49  |     const { error } = await player.client.from("characters").insert({
  50  |       id: kiraId,
  51  |       owner_id: player.userId,
  52  |       name: "E2E Kira",
  53  |       campaign_id: campaignId,
  54  |     });
  55  |     if (error) {
  56  |       throw new Error(`e2e: could not create player character: ${error.message}`);
  57  |     }
  58  |   });
  59  | 
  60  |   test.afterAll(async () => {
  61  |     if (campaignId) {
  62  |       await deleteCampaignAsAdmin(config, campaignId).catch(() => {});
  63  |     }
  64  |     await Promise.all(
  65  |       people.map((person) =>
  66  |         deletePerson(config, person.userId).catch(() => {})
  67  |       )
  68  |     );
  69  |     people = [];
  70  |   });
  71  | 
  72  |   test("a custom dice roll from the sheet posts as the character", async ({
  73  |     browser,
  74  |   }) => {
  75  |     // Reduced motion skips the 3D dice, so rolls resolve immediately.
  76  |     const gmContext = await browser.newContext({ reducedMotion: "reduce" });
  77  |     const playerContext = await browser.newContext({
  78  |       reducedMotion: "reduce",
  79  |     });
  80  |     const gmPage = await gmContext.newPage();
  81  |     const playerPage = await playerContext.newPage();
  82  |     try {
  83  |       await signInAs(gmPage, config, gm, campaignUrl(campaignId));
  84  |       await signInAs(
  85  |         playerPage,
  86  |         config,
  87  |         player,
  88  |         `/characters/${kiraId}?tab=notes`
  89  |       );
  90  | 
  91  |       // The sheet's roll log sits behind the Notes sidebar; its footer
  92  |       // rolls the dice.
  93  |       await expect(
  94  |         playerPage.getByRole("tab", { name: "Notes" })
  95  |       ).toBeVisible();
  96  |       await playerPage.getByText("Roll Log").click();
  97  |       await playerPage
  98  |         .getByRole("button", { name: "Roll Dice" })
  99  |         .click();
  100 |       await expect(
  101 |         playerPage.getByText("Custom Dice Roll")
  102 |       ).toBeVisible();
  103 |       await playerPage
  104 |         .getByRole("button", { name: "Roll", exact: true })
  105 |         .click();
  106 | 
  107 |       // The roll lands in the starting IC channel as the character, live
  108 |       // for a GM already reading chat.
  109 |       await playerPage.goto(campaignUrl(campaignId));
  110 |       const oneLiner = playerPage.getByRole("button", {
  111 |         name: /^1d6: \d+ \(\d+\)$/,
  112 |       });
> 113 |       await expect(oneLiner).toBeVisible();
      |                              ^ Error: expect(locator).toBeVisible() failed
  114 |       await expect(playerPage.getByText("E2E Kira").first()).toBeVisible();
  115 |       await expect(
  116 |         gmPage.getByRole("button", { name: /^1d6: \d+ \(\d+\)$/ })
  117 |       ).toBeVisible();
  118 |       await expect(gmPage.getByText("E2E Kira").first()).toBeVisible();
  119 |     } finally {
  120 |       await playerContext.close().catch(() => {});
  121 |       await gmContext.close().catch(() => {});
  122 |     }
  123 |   });
  124 | });
  125 | 
```