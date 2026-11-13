import {
  Box,
  Link,
  SxProps,
  Theme,
  Typography,
  TypographyProps,
  useTheme,
} from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStore } from "stores/store";
import { OracleTableRenderer } from "./OracleTableRenderer";
import { idMap } from "data/idMap";
import { Datasworn, IdParser } from "@datasworn-community/core";

export interface MarkdownRendererProps {
  inlineParagraph?: boolean;
  markdown: string;
  inheritColor?: boolean;
  disableLinks?: boolean;
  typographyVariant?: TypographyProps["variant"];
  sx?: SxProps<Theme>;
}

const SAFE_LINK_SCHEMES = new Set(["http", "https", "mailto", "datasworn"]);

/**
 * Lowercased scheme of a link target, or null when the target is relative.
 * All whitespace is stripped before the check because browsers drop
 * tab and newline characters from URLs, which would otherwise hide a scheme
 * such as `java\tscript:` from a plain prefix test.
 */
function linkScheme(href: string): string | null {
  const compact = href.replace(/\s+/g, "");
  const match = compact.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Only web, mail, the app's own datasworn, and relative links are safe to
 * follow. Anything else - javascript:, data:, vbscript:, ... - must never
 * render as a clickable link, since post text comes from other players.
 */
function isSafeLink(href: string): boolean {
  if (!href || !href.trim()) {
    return false;
  }
  const scheme = linkScheme(href);
  // No scheme means a relative link inside the app - safe to follow.
  return scheme === null || SAFE_LINK_SCHEMES.has(scheme);
}

export function MarkdownRenderer(props: MarkdownRendererProps) {
  const {
    inlineParagraph,
    markdown,
    inheritColor,
    disableLinks,
    typographyVariant,
    sx,
  } = props;

  const openDialog = useStore((store) => store.appState.openDialog);

  const theme = useTheme();

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => {
          if (
            typeof children === "string" ||
            (Array.isArray(children) &&
              children.length > 0 &&
              typeof children[0] === "string")
          ) {
            const content =
              typeof children === "string" ? children : (children[0] as string);
            if (
              content.match(
                /^{{table:[^/]+(\/collections)?\/oracles\/[^}]+}}$/
              ) ||
              content.match(/^{{table>[^}]+}}$/)
            ) {
              const id = content
                .replace("{{table:", "")
                .replace("}}", "")
                .replace("{{table>", "");
              let oracle: Datasworn.OracleRollable | undefined = undefined;
              try {
                const tmpOracle = IdParser.get(id) as Datasworn.OracleRollable;
                if (tmpOracle.type === "oracle_rollable") {
                  oracle = tmpOracle;
                }
              } catch {
                // Empty - if oracle is undefined we will continue parsing
              }
              if (oracle) {
                return <OracleTableRenderer oracle={oracle} />;
              }
            } else if (content.match(/^{{table:[^/]+\/truths\/[^}]+}}$/)) {
              return null;
            } else if (content.match(/^{{table_columns>[^}]+}}$/)) {
              // Asks for every oracle column of the move this text belongs to.
              // MoveOracles renders those tables, with roll buttons, directly
              // after this text - so drop the directive rather than printing it
              // raw, which is what happened before.
              return null;
            }
          }
          return (
            <Typography
              variant={typographyVariant ?? "body2"}
              display={inlineParagraph ? "inline" : "block"}
              color={
                inheritColor
                  ? "inherit"
                  : (theme) =>
                      inlineParagraph
                        ? theme.palette.text.secondary
                        : theme.palette.text.primary
              }
              py={inlineParagraph ? 0 : 1}
              textAlign={"left"}
              whiteSpace={"pre-wrap"}
              sx={sx}
            >
              {children}
            </Typography>
          );
        },
        li: ({ children }) => (
          <Typography
            component={"li"}
            variant={typographyVariant ?? "body2"}
            color={
              inheritColor
                ? "inherit"
                : (theme) =>
                    inlineParagraph
                      ? theme.palette.text.secondary
                      : theme.palette.text.primary
            }
            sx={sx}
          >
            {children}
          </Typography>
        ),
        ul: ({ children }) => (
          <Box component={"ul"} pl={1.5} sx={sx}>
            {children}
          </Box>
        ),
        table: ({ children }) => (
          <Box
            component={"table"}
            mt={2}
            mb={1}
            border={1}
            borderColor={(theme) => theme.palette.divider}
            borderRadius={(theme) => `${theme.shape.borderRadius}px`}
            sx={[
              { borderCollapse: "collapse" },
              ...(Array.isArray(sx) ? sx : [sx]),
            ]}
          >
            {children}
          </Box>
        ),
        thead: ({ children }) => (
          <Box
            component={"thead"}
            bgcolor={(theme) => theme.palette.background.paperInlayDarker}
            sx={sx}
          >
            {children}
          </Box>
        ),
        th: ({ children }) => (
          <Typography
            component={"th"}
            variant={typographyVariant ?? "body2"}
            textAlign={"left"}
            p={1}
            minWidth={"8ch"}
            sx={sx}
          >
            <b>{children}</b>
          </Typography>
        ),
        tr: ({ children }) => (
          <Box
            component={"tr"}
            sx={[
              (theme) => ({
                "&:nth-of-type(even)": {
                  backgroundColor: theme.palette.background.paperInlay,
                },
              }),
              ...(Array.isArray(sx) ? sx : [sx]),
            ]}
          >
            {children}
          </Box>
        ),
        td: ({ children }) => (
          <Typography
            component={"td"}
            px={1}
            py={0.5}
            variant={typographyVariant ?? "body2"}
            color={(theme) => theme.palette.text.primary}
            sx={sx}
          >
            {children}
          </Typography>
        ),
        a: (linkProps) => {
          if (disableLinks) {
            return <>{linkProps.children}</>;
          }

          const propertiesHref = linkProps.node?.properties?.href;

          const href = typeof propertiesHref === "string" ? propertiesHref : "";

          const trimmedHref = href.trim();

          if (/^datasworn:/i.test(trimmedHref)) {
            const strippedHref = trimmedHref.replace(/^datasworn:/i, "");
            // We have a datasworn id
            const id = idMap[strippedHref] ?? strippedHref;

            let item: unknown;
            try {
              item = IdParser.get(id);
            } catch {
              // console.warn("Could not find in datasworn");
              // Empty - if item is undefined we will continue parsing
            }

            if (item) {
              return (
                <Link
                  component={"button"}
                  type={"button"}
                  sx={[
                    {
                      cursor: "pointer",
                      verticalAlign: "baseline",
                    },
                    ...(Array.isArray(sx) ? sx : [sx]),
                  ]}
                  color={
                    theme.palette.mode === "light" ? "info.dark" : "info.light"
                  }
                  onClick={() => openDialog(id)}
                >
                  {linkProps.children}
                </Link>
              );
            } else {
              // TODO - add error styling
              return <Typography>{linkProps.children}</Typography>;
            }
          }

          // Post text comes from other players, so only safe links render as
          // clickable anchors. Anything else (javascript:, data:,
          // vbscript:, ...) renders as plain text with no href to run.
          if (!isSafeLink(href)) {
            return <>{linkProps.children}</>;
          }
          return <a {...linkProps} rel="noopener noreferrer" />;
        },
      }}
      urlTransform={(url) => (isSafeLink(url) ? url : "")}
    >
      {markdown}
    </ReactMarkdown>
  );
}
