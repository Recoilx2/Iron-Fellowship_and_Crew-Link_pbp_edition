export interface Truth {
  selectedTruthOptionIndex?: number;
  selectedSubItemIndex?: number | null;

  customTruth?: {
    description: string;
    questStarter: string;
  };
}

export interface World {
  settingKey: string;
  name: string;
  worldDescription?: Uint8Array;
  newTruths?: Record<string, Truth>;
  ownerIds: string[];
}
