import { Button, ButtonProps } from "@mui/material";
import { useRoller } from "stores/appState/useRoller";
import { useStore } from "stores/store";
import RollIcon from "@mui/icons-material/Casino";
import { Datasworn, IdParser } from "@datasworn-community/core";
import { useReferenceMode } from "hooks/useReferenceMode";

export interface OracleButtonProps extends ButtonProps {
  oracleId: string;
}

export function OracleButton(props: OracleButtonProps) {
  const { oracleId, children, ...buttonProps } = props;

  let oracle:
    | Datasworn.OracleRollable
    | Datasworn.OracleCollection
    | undefined = undefined;

  try {
    const tmpOracle = IdParser.get(oracleId) as
      | Datasworn.OracleRollable
      | Datasworn.OracleCollection;
    if (
      tmpOracle.type === "oracle_rollable" ||
      tmpOracle.type === "oracle_collection"
    ) {
      oracle = tmpOracle;
    }
  } catch {
    // We will continue parsing with oracle as undefined
  }

  const shouldOracleRollBeGMSOnly = useStore(
    (store) => !store.characters.currentCharacter.currentCharacterId
  );

  const { rollOracleTable } = useRoller();
  const isReferenceMode = useReferenceMode();

  if (isReferenceMode || !oracle || oracle.oracle_type === "tables") {
    return null;
  }
  return (
    <Button
      {...buttonProps}
      onClick={() => rollOracleTable(oracleId, true, shouldOracleRollBeGMSOnly)}
      endIcon={<RollIcon data-testid="CasinoIcon" />}
    >
      {children ?? oracle.name}
    </Button>
  );
}
