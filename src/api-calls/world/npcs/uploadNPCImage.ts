import { constructNPCImagesPath, getNPCDoc } from "./_getRef";
import { replaceImage } from "api-calls/storage/replaceImage";
import { updateDoc } from "firebase/firestore";
import { createApiFunction } from "api-calls/createApiFunction";

export const uploadNPCImage = createApiFunction<
  { worldId: string; npcId: string; image: File; oldImageFilename?: string },
  void
>((params) => {
  const { worldId, npcId, image, oldImageFilename } = params;

  return new Promise((resolve, reject) => {
    replaceImage(
      constructNPCImagesPath(worldId, npcId),
      oldImageFilename,
      image
    )
      .then(() => {
        const filename = image.name;
        updateDoc(getNPCDoc(worldId, npcId), {
          imageFilenames: [filename],
        })
          .then(() => {
            resolve();
          })
          .catch(reject);
      })
      .catch(reject);
  });
}, "Failed to upload image");
