// PROTOTYPE (#6) "Chat-first campaign screen": three layouts of the campaign
// screen with chat as the main view, switchable via ?variant=A|B|C on the
// throwaway route /prototype/chat. Sample data, in memory, no database.
// Throwaway: lives on the prototype/chat-screen branch, never merged.
import { Box, FormControlLabel, Switch, Typography } from "@mui/material";
import { useSearchParams } from "react-router-dom";
import { PageContent, PageHeader } from "components/shared/Layout";
import { PrototypeSwitcher } from "components/shared/PrototypeSwitcher";
import { usePrototypeChat, speakerName } from "./usePrototypeChat";
import { VariantA, name as nameA } from "./VariantA";
import { VariantB, name as nameB } from "./VariantB";
import { VariantC, name as nameC } from "./VariantC";
import { VariantD, name as nameD } from "./VariantD";

const variants = [
  { key: "A", name: nameA },
  { key: "B", name: nameB },
  { key: "C", name: nameC },
  { key: "D", name: nameD },
];

export function Component() {
  const [params] = useSearchParams();
  const variant = params.get("variant") ?? "D";
  const chat = usePrototypeChat();

  return (
    <>
      <PageHeader label={"The Ashen Reach"} subLabel={"Prototype: chat-first campaign screen"} />
      <PageContent viewHeight isPaper sx={{ pb: { xs: 10, md: 8 }, pt: { xs: 0, md: 2 } }}>
        <Box sx={{ height: "100%", minHeight: 0 }}>
          {variant === "A" && <VariantA chat={chat} />}
          {variant === "B" && <VariantB chat={chat} />}
          {variant === "C" && <VariantC chat={chat} />}
          {variant === "D" && <VariantD chat={chat} />}
        </Box>
      </PageContent>
      <PrototypeSwitcher
        variants={variants}
        current={variant}
        alwaysShown={
          <FormControlLabel
          sx={{ ml: 1, mr: 0.5 }}
          control={<Switch size={"small"} checked={chat.viewAsGM} onChange={(e) => chat.setViewAsGM(e.target.checked)} />}
          label={<Typography sx={{ fontFamily: "monospace", fontSize: 13 }}>{chat.viewAsGM ? "as GM" : "as player"}</Typography>}
          />
        }
      >
        <Typography sx={{ fontFamily: "monospace", fontSize: 12, opacity: 0.75, pr: 1 }}>
          #{chat.channel.name} · {chat.posts.length} posts · as {speakerName(chat.speaker, chat.myUid)}
          {chat.draft.text || chat.draft.images.length || chat.draft.roll ? " · draft kept" : ""}
        </Typography>
      </PrototypeSwitcher>
    </>
  );
}
