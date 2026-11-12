import { createApiFunction } from "api-calls/createApiFunction";
import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { getHomebrewMoveCategoryDoc } from "./_getRef";
import { HomebrewMoveCategoryDocument } from "api-calls/homebrew/moves/categories/_homebrewMoveCategory.type";

export const updateHomebrewMoveCategory = createApiFunction<
  {
    moveCategoryId: string;
    moveCategory: DocumentUpdate<HomebrewMoveCategoryDocument>;
  },
  void
>((params) => {
  const { moveCategory, moveCategoryId } = params;
  return new Promise((resolve, reject) => {
    updateDoc(
      getHomebrewMoveCategoryDoc(moveCategoryId),
      moveCategory as UpdateData<HomebrewMoveCategoryDocument>
    )
      .then(() => resolve())
      .catch(reject);
  });
}, "Failed to update move category.");
