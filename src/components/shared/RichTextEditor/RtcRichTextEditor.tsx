import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";
import { RtcEditorComponent } from "./RtcEditorComponent";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { useCreateRefFrom } from "hooks/useCreateRefFrom";
import {
  getHocuspocusToken,
  getHocuspocusUrl,
} from "config/hocuspocus.config";

export interface RtcRichTextEditorProps {
  id: string;
  documentName: string;
  onSave?: (
    documentId: string,
    notes: Uint8Array,
    isBeaconRequest?: boolean,
    title?: string
  ) => Promise<boolean | void>;
  onDelete?: (id: string) => void;
  initialValue?: Uint8Array;
  showTitle?: boolean;
  /**
   * The note server owns the document bytes (character and campaign notes):
   * saves only carry the title, and closing the tab needs no beacon save.
   * World notes persist through onSave snapshots instead until their ticket
   * ports them onto the server.
   */
  serverPersisted?: boolean;
  extraEditorActions?: ReactNode;
}

export function RtcRichTextEditor(props: RtcRichTextEditorProps) {
  const {
    id,
    documentName,
    onSave,
    onDelete,
    initialValue,
    showTitle,
    serverPersisted,
    extraEditorActions,
  } = props;
  const initialValueRef = useCreateRefFrom(initialValue);

  const [yDoc, setYDoc] = useState<Y.Doc>();
  const [provider, setProvider] = useState<HocuspocusProvider>();

  const hasUnsavedChangesRef = useRef<boolean>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const lastSavedTitleRef = useRef<string | undefined>(undefined);

  const [saving, setSaving] = useState<boolean>(false);
  const [synced, setSynced] = useState<boolean>(false);

  const handleSave = useCallback(
    (idToPass: string, doc: Y.Doc, isBeaconRequest?: boolean) => {
      if (onSave) {
        const title = showTitle ? extractTitle(doc) : undefined;
        // Server-persisted scopes only need the title: the bytes already
        // live on the server, so unchanged titles skip the write.
        if (serverPersisted && title === lastSavedTitleRef.current) {
          setHasUnsavedChanges(false);
          hasUnsavedChangesRef.current = false;
          return;
        }
        lastSavedTitleRef.current = title;
        const notes = Y.encodeStateAsUpdate(doc);
        setHasUnsavedChanges(false);
        hasUnsavedChangesRef.current = false;
        setSaving(true);
        onSave(idToPass, notes, isBeaconRequest, title)
          .catch((e) => {
            console.error(e);
          })
          .finally(() => {
            setSaving(false);
          });
      }
    },
    [showTitle, onSave, serverPersisted]
  );

  useEffect(() => {
    // Recreate our yDoc and Provider
    const newYDoc = new Y.Doc();
    if (initialValueRef.current) {
      Y.applyUpdate(newYDoc, initialValueRef.current);
    }
    if (showTitle) {
      lastSavedTitleRef.current = extractTitle(newYDoc);
    }

    // Any local or remote change leaves something to save: the full
    // snapshot for world notes, the title for server-persisted notes.
    newYDoc?.on("update", () => {
      setHasUnsavedChanges(true);
      hasUnsavedChangesRef.current = true;
    });

    const newProvider = new HocuspocusProvider({
      url: getHocuspocusUrl(),
      name: documentName,
      document: newYDoc,
      token: getHocuspocusToken,
      onSynced: () => setSynced(true),
      onUnsyncedChanges: () => setSynced(false),
      onAuthenticationFailed: ({ reason }) => {
        console.error(
          `Note ${documentName} is not available live: ${reason ?? "not authorized"}`
        );
      },
    });

    setProvider(newProvider);
    setYDoc(newYDoc);
    setHasUnsavedChanges(false);
    setSaving(false);
    setSynced(false);
    hasUnsavedChangesRef.current = false;

    return () => {
      if (hasUnsavedChangesRef.current && newYDoc) {
        handleSave(id, newYDoc);
      }
      try {
        newYDoc?.destroy();
        newProvider?.destroy();
      } catch (e) {
        // Suppress error
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentName, id, handleSave]);

  // Handle save on page unload. Server-persisted notes need no beacon: the
  // server already holds the document and writes it on its debounce.
  useEffect(() => {
    const onUnloadFunction = () => {
      if (
        document.visibilityState === "hidden" &&
        hasUnsavedChangesRef.current &&
        yDoc
      ) {
        handleSave(id, yDoc, !serverPersisted);
      }
    };
    document.addEventListener("visibilitychange", onUnloadFunction);

    return () => {
      document.removeEventListener("visibilitychange", onUnloadFunction);
    };
  }, [handleSave, yDoc, id, serverPersisted]);

  useEffect(() => {
    let timeout: NodeJS.Timeout;
    if (yDoc && hasUnsavedChanges) {
      timeout = setTimeout(() => {
        handleSave(id, yDoc);
      }, 30 * 1000);
    }

    return () => {
      clearTimeout(timeout);
    };
  }, [yDoc, hasUnsavedChanges, handleSave, id]);

  useEffect(() => {
    if (!hasUnsavedChangesRef.current && yDoc && initialValue) {
      if (initialValue) {
        Y.applyUpdate(yDoc, initialValue);
        if (showTitle) {
          lastSavedTitleRef.current = extractTitle(yDoc);
        }
      }
    }
  }, [initialValue, yDoc, showTitle]);

  if (!yDoc || !provider) {
    return null;
  }

  return (
    <RtcEditorComponent
      readOnly={!onSave}
      provider={provider}
      doc={yDoc}
      saving={saving || !synced}
      deleteNote={onDelete ? () => onDelete(id) : undefined}
      withHeading={showTitle}
      extraEditorActions={extraEditorActions}
    />
  );
}

function extractTitle(doc: Y.Doc): string | undefined {
  const jsonContent = TiptapTransformer.fromYdoc(doc, "default");
  let currentNode = jsonContent.content?.[0];
  while (currentNode && !currentNode.text) {
    currentNode = currentNode.content?.[0];
  }
  return currentNode?.text ?? "Placeholder Title";
}
