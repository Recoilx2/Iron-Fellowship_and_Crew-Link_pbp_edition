import { useEffect, useState } from "react";
import { Box, Dialog, Stack } from "@mui/material";
import {
  CHAT_IMAGE_SIGNED_URL_TTL_SECONDS,
  getChatImageUrl,
} from "api-calls/chat/chatImages";

// Signed URLs are per-object and short-lived (minutes, so a revoked
// member's links stop working quickly): the cache remembers each link with
// its signing time, and an image shown with a stale link is signed again,
// on display and once a minute while mounted, instead of serving the
// expired URL.
const urlCache = new Map<string, { url: string; signedAt: number }>();

// A link counts as stale shortly before it expires, so the refresh lands
// before the old one stops working.
const REFRESH_SKEW_MS = 60 * 1000;

function freshCachedUrl(path: string, now: number): string | undefined {
  const entry = urlCache.get(path);
  if (
    entry &&
    now - entry.signedAt <
      CHAT_IMAGE_SIGNED_URL_TTL_SECONDS * 1000 - REFRESH_SKEW_MS
  ) {
    return entry.url;
  }
  return undefined;
}

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

    function resolve(path: string) {
      if (freshCachedUrl(path, Date.now())) {
        return;
      }
      getChatImageUrl(path).then(
        (url) => {
          if (!live) {
            return;
          }
          urlCache.set(path, { url, signedAt: Date.now() });
          setUrls((current) =>
            current[path] === url ? current : { ...current, [path]: url }
          );
        },
        () => {
          if (live) {
            setFailed((current) => ({ ...current, [path]: true }));
          }
        }
      );
    }

    for (const path of paths) {
      resolve(path);
    }
    const refresh = setInterval(() => {
      if (!live) {
        return;
      }
      for (const path of paths) {
        resolve(path);
      }
    }, REFRESH_SKEW_MS);
    return () => {
      live = false;
      clearInterval(refresh);
    };
  }, [paths]);

  const open = openIndex !== null ? paths[openIndex] : undefined;
  const openUrl = open
    ? (freshCachedUrl(open, Date.now()) ?? urls[open])
    : undefined;

  return (
    <>
      <Stack direction={"row"} spacing={1} sx={{ flexWrap: "wrap", py: 0.5 }}>
        {paths.map((path, index) => {
          const url = freshCachedUrl(path, Date.now()) ?? urls[path];
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
