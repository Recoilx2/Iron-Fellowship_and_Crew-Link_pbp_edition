export interface AccessibilitySettingsDocument {
  verboseRollResults?: boolean;
  /** Global opt-in for chat-post email; a false value overrides channel choices. */
  emailNotificationsEnabled?: boolean;
}
export interface OracleSettingsDocument {
  pinnedOracleSections?: { [key: string]: boolean };
}
