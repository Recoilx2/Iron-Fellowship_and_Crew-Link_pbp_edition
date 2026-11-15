# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: chat-momentum-burn.spec.ts >> chat momentum burn on a posted roll >> a player burns momentum on a posted roll, and a second browser sees the update
- Location: e2e/chat-momentum-burn.spec.ts:125:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: /^Face Danger:.*Weak Hit.*2 vs 3, 8/ })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('button', { name: /^Face Danger:.*Weak Hit.*2 vs 3, 8/ }) with timeout 15000ms
  - waiting for getByRole('button', { name: /^Face Danger:.*Weak Hit.*2 vs 3, 8/ })

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
  - heading "E2E Burn 1794677540023" [level=1]
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
      - listitem: In character
      - button "# In character"
      - listitem: Out of character
      - button "# Out of character"
      - listitem: People
      - button "E e2e-player you" [disabled]:
        - text: E e2e-player
        - paragraph: you
      - button "E e2e-gm GM · direct message":
        - text: E e2e-gm
        - paragraph: GM · direct message
      - button "E e2e-other direct message":
        - text: E e2e-other
        - paragraph: direct message
      - button "Show archived":
        - paragraph: Show archived
    - paragraph: "# In character in character"
    - heading "E" [level=6]
    - paragraph: E2E Kira
    - text: e2e-player Sat 5:32 PM
    - paragraph: Kira dives for cover.
    - 'button "Face Danger: Miss · 2 vs 3, 8" [expanded]': Face Danger Miss · 2 vs 3, 8
    - text: Face Danger, using Edge. Action die 2, total 2. Challenge dice 3 and 8. Miss.
    - button "Burn momentum"
    - button "Edit post": Edit
    - button "Delete post": Delete
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
    - text: edge 0 heart 0 iron 0 shadow 0 wits 0 health +5 spirit +5 Momentum +5
    - button "Assets"
    - button "XP and Bonds"
    - 'button "Retire: E2E Kira"': Retire
    - 'button "Remove Character: E2E Kira"': Remove Character
    - 'link "Open Sheet: E2E Kira"':
      - /url: /characters/beaa382c-6204-4215-9c15-5c78b49ce3fc
      - text: Open Sheet
    - heading "Players" [level=2]
    - button "Invite Players"
    - text: E
    - heading "e2e-player" [level=3]
    - text: E
    - heading "e2e-gm" [level=3]
    - text: E
    - heading "e2e-other" [level=3]
- list
```

# Test source

```ts
  61  |       throw new Error(
  62  |         `e2e: could not create player character: ${charError.message}`
  63  |       );
  64  |     }
  65  | 
  66  |     // The starting IC channel.
  67  |     const { data: channelData, error: channelError } = await gm.client
  68  |       .from("chat_channels")
  69  |       .select("id")
  70  |       .eq("campaign_id", campaignId)
  71  |       .eq("kind", "IC")
  72  |       .eq("is_starting", true)
  73  |       .single();
  74  |     if (channelError || !channelData) {
  75  |       throw new Error(
  76  |         `e2e: no starting IC channel: ${channelError?.message}`
  77  |       );
  78  |     }
  79  |     const icChannelId = (channelData as { id: string }).id;
  80  | 
  81  |     // A posted miss the burn will lift: action 2 vs 3 and 8, momentum 5
  82  |     // beats 3 but not 8, so a miss becomes a weak hit.
  83  |     const { data: postData, error: postError } = await player.client
  84  |       .from("chat_posts")
  85  |       .insert({
  86  |         id: crypto.randomUUID(),
  87  |         channel_id: icChannelId,
  88  |         author_id: player.userId,
  89  |         speaker_character_id: kiraId,
  90  |         text: "Kira dives for cover.",
  91  |         roll: {
  92  |           type: 0,
  93  |           rollLabel: "Edge",
  94  |           moveName: "Face Danger",
  95  |           action: 2,
  96  |           challenge1: 3,
  97  |           challenge2: 8,
  98  |           result: 2,
  99  |           timestamp: new Date().toISOString(),
  100 |           characterId: kiraId,
  101 |           uid: player.userId,
  102 |           gmsOnly: false,
  103 |         },
  104 |         gms_only: false,
  105 |       })
  106 |       .select("id")
  107 |       .single();
  108 |     if (postError || !postData) {
  109 |       throw new Error(`e2e: could not post roll: ${postError?.message}`);
  110 |     }
  111 |   });
  112 | 
  113 |   test.afterAll(async () => {
  114 |     if (campaignId) {
  115 |       await deleteCampaignAsAdmin(config, campaignId).catch(() => {});
  116 |     }
  117 |     await Promise.all(
  118 |       people.map((person) =>
  119 |         deletePerson(config, person.userId).catch(() => {})
  120 |       )
  121 |     );
  122 |     people = [];
  123 |   });
  124 | 
  125 |   test("a player burns momentum on a posted roll, and a second browser sees the update", async ({
  126 |     browser,
  127 |   }) => {
  128 |     const playerContext = await browser.newContext({ reducedMotion: "reduce" });
  129 |     const otherContext = await browser.newContext({ reducedMotion: "reduce" });
  130 |     const playerPage = await playerContext.newPage();
  131 |     const otherPage = await otherContext.newPage();
  132 |     try {
  133 |       await signInAs(playerPage, config, player, campaignUrl(campaignId));
  134 |       await signInAs(otherPage, config, other, campaignUrl(campaignId));
  135 | 
  136 |       await expect(
  137 |         playerPage.getByRole("tab", { name: "Chat" })
  138 |       ).toBeVisible();
  139 | 
  140 |       // The posted miss reads as a weak-hit-to-be: action 2 vs 3, 8.
  141 |       const playerOneLiner = playerPage.getByRole("button", {
  142 |         name: /^Face Danger:.*Miss.*2 vs 3, 8/,
  143 |       });
  144 |       await expect(playerOneLiner).toBeVisible();
  145 |       const otherOneLiner = otherPage.getByRole("button", {
  146 |         name: /^Face Danger:.*Miss.*2 vs 3, 8/,
  147 |       });
  148 |       await expect(otherOneLiner).toBeVisible();
  149 | 
  150 |       // The author expands the roll and burns momentum on it.
  151 |       await playerOneLiner.click();
  152 |       await expect(playerOneLiner).toHaveAttribute("aria-expanded", "true");
  153 |       await playerPage.getByRole("button", { name: "Burn momentum" }).click();
  154 | 
  155 |       // The burned outcome arrives live in both browsers: momentum 5
  156 |       // replaces the action total, so the miss becomes a weak hit.
  157 |       await expect(
  158 |         playerPage.getByRole("button", {
  159 |           name: /^Face Danger:.*Weak Hit.*2 vs 3, 8/,
  160 |         })
> 161 |       ).toBeVisible();
      |         ^ Error: expect(locator).toBeVisible() failed
  162 |       await expect(
  163 |         otherPage.getByRole("button", {
  164 |           name: /^Face Danger:.*Weak Hit.*2 vs 3, 8/,
  165 |         })
  166 |       ).toBeVisible();
  167 | 
  168 |       // Nobody else is offered the burn on the author's roll. The burn
  169 |       // rewrote the one-liner (Miss became Weak Hit), so the pre-burn Miss
  170 |       // locator above no longer matches; target the burned roll instead.
  171 |       const otherBurnedOneLiner = otherPage.getByRole("button", {
  172 |         name: /^Face Danger:.*Weak Hit.*2 vs 3, 8/,
  173 |       });
  174 |       await otherBurnedOneLiner.click();
  175 |       await expect(otherBurnedOneLiner).toHaveAttribute(
  176 |         "aria-expanded",
  177 |         "true"
  178 |       );
  179 |       await expect(
  180 |         otherPage.getByRole("button", { name: "Burn momentum" })
  181 |       ).toHaveCount(0);
  182 |     } finally {
  183 |       await playerContext.close().catch(() => {});
  184 |       await otherContext.close().catch(() => {});
  185 |     }
  186 |   });
  187 | });
  188 | 
```