import { UpdateData, updateDoc } from "firebase/firestore";
import { DocumentUpdate } from "api-calls/helpers.type";
import { getUsersDoc } from "./_getRef";
import { UserDocument } from "api-calls/user/_user.type";
import { createApiFunction } from "api-calls/createApiFunction";

export const updateUserDocNestedFields = createApiFunction<
  { uid: string; user: DocumentUpdate<UserDocument> },
  void
>((params) => {
  const { uid, user } = params;
  return new Promise((resolve, reject) => {
    updateDoc(getUsersDoc(uid), user as UpdateData<UserDocument>)
      .then(() => {
        resolve();
      })
      .catch((e) => {
        console.error(e);
        reject("Failed to update user");
      });
  });
}, "Failed to update user information.");
