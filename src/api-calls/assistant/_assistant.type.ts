/**
 * Documents for the GM assistant data layer. Conversations and their
 * messages belong to the GM who started them; the settings row holds that
 * GM's model choice and saved context choice for the campaign. The context
 * choice stores references only, never text: the server builds the actual
 * context from these references at request time.
 */

export type AssistantMessageRole = "user" | "assistant";

export interface AssistantConversationDocument {
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface AssistantConversationWithId
  extends AssistantConversationDocument {
  id: string;
  campaignId: string;
  ownerId: string;
}

/**
 * What the GM did with an outline proposal carried by a reply: applied it
 * or dismissed it. A proposal that was undone, or never acted on, is null.
 */
export type AssistantProposalState = "applied" | "dismissed";

export interface AssistantMessageDocument {
  role: AssistantMessageRole;
  content: string;
  /** A reply stopped partway still keeps the text written so far. */
  stoppedPartway: boolean;
  /** Null until the GM applies or dismisses the reply's outline proposal. */
  proposalState: AssistantProposalState | null;
  /**
   * The outline version this reply's Apply kept, for Undo; null when none
   * was kept, or once that version was undone or pruned.
   */
  appliedVersionId: string | null;
  createdAt: string;
}

export interface AssistantMessageWithId extends AssistantMessageDocument {
  id: string;
  conversationId: string;
}

export interface AssistantItemReference {
  id: string;
  includeGmParts: boolean;
}

export interface AssistantChannelReference {
  id: string;
  postCount: number;
}

export interface AssistantContextChoice {
  includeOutline: boolean;
  lore: AssistantItemReference[];
  npcs: AssistantItemReference[];
  locations: AssistantItemReference[];
  notes: string[];
  channels: AssistantChannelReference[];
}

export interface AssistantSettingsDocument {
  /** The model the GM chose; null until they choose one. */
  model: string | null;
  context: AssistantContextChoice;
  updatedAt: string;
}

export function emptyAssistantContextChoice(): AssistantContextChoice {
  return {
    includeOutline: false,
    lore: [],
    npcs: [],
    locations: [],
    notes: [],
    channels: [],
  };
}
