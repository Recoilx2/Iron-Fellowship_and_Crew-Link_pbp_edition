import { storage } from "config/firebase.config";
import { getDownloadURL, ref } from "firebase/storage";

export function getImageUrl(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const imageRef = ref(storage, path);

    getDownloadURL(imageRef)
      .then((url) => resolve(url))
      .catch((e) => {
        console.error(e);
        reject(e);
      });
  });
}
