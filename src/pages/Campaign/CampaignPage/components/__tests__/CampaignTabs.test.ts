import { describe, expect, it } from "vitest";

import {
  CampaignTabs,
  DEFAULT_CAMPAIGN_TAB,
} from "../CampaignTabs";

// Opening a campaign lands on chat: Chat stays the first campaign tab and
// the tab a campaign opens on.
describe("campaign tabs", () => {
  it("lists Chat first with the existing tabs after it", () => {
    expect(Object.values(CampaignTabs)[0]).toBe(CampaignTabs.Chat);
    expect(Object.values(CampaignTabs)).toEqual(
      expect.arrayContaining([
        CampaignTabs.Characters,
        CampaignTabs.Tracks,
        CampaignTabs.Notes,
        CampaignTabs.World,
      ])
    );
  });

  it("opens campaigns on the Chat tab", () => {
    expect(DEFAULT_CAMPAIGN_TAB).toBe(CampaignTabs.Chat);
  });
});
