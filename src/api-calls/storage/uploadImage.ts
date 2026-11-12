import { storage } from "config/firebase.config";
import { ref, uploadBytes } from "firebase/storage";

export function uploadImage(path: string, image: File): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const imageRef = ref(storage, `${path}/${image.name}`);

    uploadBytes(imageRef, image)
      .then(() => {
        resolve(true);
      })
      .catch((e) => {
        console.error(e);
        reject(`Failed to upload ${image.name}.`);
      });
  });
}
