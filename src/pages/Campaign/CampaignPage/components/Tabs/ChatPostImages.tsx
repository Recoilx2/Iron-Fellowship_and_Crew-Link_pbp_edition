import { useEffect, useState } from "react";
import { Box, Dialog, Stack } from "@mui/material";
import { getChatImageUrl } from "api-calls/chat/chatImages";

// Signed URLs are per-object and long-lived (a week): one module cache
// keeps the feed from re-signing every image on every live arrival.
const urlCache = new Map<string, string>();

/**
 * A post's image attachments (spec #9, ticket #28): thumbnails inline in
 * the feed, the full image in a dialog on tap. Only campaign members ever
 * receive URLs, because the chat-images access rules refuse everyone else.
 */
export function ChatPostImages(props: { paths: string[] }) {
  const { paths } = props;
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    for (const path of paths) {
      if (urlCache.has(path)) {
        continue;
      }
      getChatImageUrl(path).then(
        (url) => {
          if (!live) {
            return;
          }
          urlCache.set(path, url);
          setUrls((current) =>
            current[path] ? current : { ...current, [path]: url }
          );
        },
        () => {
          if (live) {
            setFailed((current) => ({ ...current, [path]: true }));
          }
        }
      );
    }
    return () => {
      live = false;
    };
  }, [paths]);

  const open = openIndex !== null ? paths[openIndex] : undefined;
  const openUrl = open ? (urlCache.get(open) ?? urls[open]) : undefined;

  return (
    <>
      <Stack direction={"row"} spacing={1} sx={{ flexWrap: "wrap", py: 0.5 }}>
        {paths.map((path, index) => {
          const url = urlCache.get(path) ?? urls[path];
          if (failed[path]) {
            return null;
          }
          return (
            <Box
              key={path}
              component={"img"}
              src={url}
              alt={`Attached image ${index + 1}`}
              onClick={() => url && setOpenIndex(index)}
              sx={{
                maxWidth: 240,
                maxHeight: 160,
                objectFit: "cover",
                borderRadius: 1,
                cursor: url ? "pointer" : "default",
              }}
            />
          );
        })}
      </Stack>
      <Dialog
        open={open !== undefined}
        onClose={() => setOpenIndex(null)}
        maxWidth={"lg"}
        aria-label={"Attached image"}
      >
        {openUrl && (
          <Box
            component={"img"}
            src={openUrl}
            alt={"Attached image enlarged"}
            sx={{ maxWidth: "90vw", maxHeight: "90vh", display: "block" }}
          />
        )}
      </Dialog>
    </>
  );
}
