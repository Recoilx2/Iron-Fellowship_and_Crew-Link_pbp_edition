import { deleteImage } from "./deleteImage";
import { uploadImage } from "./uploadImage";
import { MAX_FILE_SIZE, MAX_FILE_SIZE_LABEL } from "./imageLimits";

export function replaceImage(
  folderPath: string,
  oldImageFilename: string | undefined,
  newImage: File
) {
  return new Promise<void>((resolve, reject) => {
    let deleteImagePromise: Promise<void> | undefined;
    if (oldImageFilename) {
      deleteImagePromise = deleteImage(folderPath, oldImageFilename);
    } else {
      deleteImagePromise = Promise.resolve();
    }

    deleteImagePromise
      .then(() => {
        if (newImage) {
          if (newImage.size > MAX_FILE_SIZE) {
            reject(
              `Image must be smaller than ${MAX_FILE_SIZE_LABEL} in size.`
            );
            return;
          }

          uploadImage(folderPath, newImage)
            .then(() => resolve())
            .catch((e) => reject(e));
        } else {
          resolve();
        }
      })
      .catch((e) => {
        console.error(e);
        reject(e);
      });
  });
}
