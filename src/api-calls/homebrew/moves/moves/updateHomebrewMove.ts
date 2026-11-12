import { createApiFunction } from "api-calls/createApiFunction";
import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { getHomebrewMoveDoc } from "./_getRef";
import { HomebrewMoveDocument } from "api-calls/homebrew/moves/moves/_homebrewMove.type";

export const updateHomebrewMove = createApiFunction<
  {
    moveId: string;
    move: DocumentUpdate<HomebrewMoveDocument>;
  },
  void
>((params) => {
  const { moveId, move } = params;
  return new Promise((resolve, reject) => {
    updateDoc(getHomebrewMoveDoc(moveId), move as UpdateData<HomebrewMoveDocument>).then(resolve).catch(reject);
  });
}, "Failed to update move.");
