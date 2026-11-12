export interface NoteDocument {
  title: string;
  order: number;
  shared?: boolean;
}

export interface NoteContentDocument {
  notes?: Uint8Array; // Converted out to JSON or HTML - see DatabaseStructure.md
}
