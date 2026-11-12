import { storage } from "config/firebase.config";
import { deleteObject, ref } from "firebase/storage";

export function deleteImage(path: string, filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const imageRef = ref(storage, `${path}/${filename}`);

    deleteObject(imageRef)
      .then(() => {
        resolve();
      })
      .catch((e) => {
        console.error(e);
        reject(`Failed to delete ${filename}.`);
      });
  });
}
