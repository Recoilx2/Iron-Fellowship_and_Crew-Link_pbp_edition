import { arrayUnion, updateDoc } from "firebase/firestore";
import { getHomebrewCollectionDoc } from "./_getRef";
import { createApiFunction } from "api-calls/createApiFunction";

export const addHomebrewViewer = createApiFunction<
  { id: string; uid: string },
  void
>((params) => {
  const { id, uid } = params;

  return new Promise((resolve, reject) => {
    updateDoc(getHomebrewCollectionDoc(id), { viewers: arrayUnion(uid) })
      .then(() => resolve())
      .catch(reject);
  });
}, "Failed to add viewer.");
