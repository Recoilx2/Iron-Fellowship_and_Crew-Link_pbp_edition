import { Box, Typography } from "@mui/material";
import { useId } from "react";
import { Head } from "providers/HeadProvider/Head";
import { PageContent } from "components/shared/Layout/PageContent";
import { PageHeader } from "components/shared/Layout/PageHeader";
import { SectionHeading } from "components/shared/SectionHeading";
import { MarkdownRenderer } from "components/shared/MarkdownRenderer";
import { MovesSection } from "components/features/charactersAndCampaigns/MovesSection";
import { OracleSection } from "components/features/charactersAndCampaigns/OracleSection";
import { ReferenceModeContext } from "hooks/useReferenceMode";
import { useStore } from "stores/store";

interface RuleTerm {
  key: string;
  label: string;
  description: string;
}

function RuleTermList(props: { labelledBy: string; terms: RuleTerm[] }) {
  const { labelledBy, terms } = props;

  return (
    <Box
      component={"ul"}
      role={"list"}
      aria-labelledby={labelledBy}
      sx={{ listStyle: "none", m: 0, py: 1, px: { xs: 2, sm: 0 } }}
    >
      {terms.map((term) => (
        <Box component={"li"} key={term.key} py={1}>
          <Typography
            variant={"subtitle1"}
            component={"h3"}
            sx={{ textTransform: "capitalize" }}
          >
            {term.label}
          </Typography>
          <MarkdownRenderer markdown={term.description} />
        </Box>
      ))}
    </Box>
  );
}

/**
 * What players see, to look up: moves, oracles, stats and condition meters of
 * the site's game system and enabled expansions. It needs no character or
 * campaign, and in reference mode nothing on it rolls or saves.
 */
export function RulesPage() {
  const statsHeadingId = useId();
  const metersHeadingId = useId();
  const stats = useStore((store) => store.rules.stats);
  const conditionMeters = useStore((store) => store.rules.conditionMeters);

  const statTerms = Object.entries(stats).map(([key, stat]) => ({
    key,
    label: stat.label,
    description: stat.description,
  }));
  const meterTerms = Object.entries(conditionMeters).map(([key, meter]) => ({
    key,
    label: meter.label,
    description: meter.description,
  }));

  return (
    <ReferenceModeContext.Provider value={true}>
      <Head title={"Rules"} />
      <PageHeader label={"Rules"} />
      <PageContent isPaper>
        <Typography color={"text.secondary"} sx={{ pt: 2, px: { xs: 2, sm: 0 } }}>
          Look up moves, oracles, stats and condition meters.
        </Typography>
        <SectionHeading
          breakContainer
          label={"Stats"}
          headingId={statsHeadingId}
        />
        <RuleTermList labelledBy={statsHeadingId} terms={statTerms} />
        <SectionHeading
          breakContainer
          label={"Condition Meters"}
          headingId={metersHeadingId}
        />
        <RuleTermList labelledBy={metersHeadingId} terms={meterTerms} />
        <SectionHeading breakContainer label={"Moves"} />
        <MovesSection shouldExpandLocally />
        <SectionHeading breakContainer label={"Oracles"} />
        <OracleSection />
      </PageContent>
    </ReferenceModeContext.Provider>
  );
}
