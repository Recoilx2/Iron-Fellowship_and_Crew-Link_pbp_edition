import { UserDocument } from "api-calls/user/_user.type";
import { AppUser } from "api-calls/auth/appUser";
import { Unsubscribe } from "api-calls/helpers.type";
import { UpdateData } from "firebase/firestore";

export enum AUTH_STATE {
  LOADING,
  UNAUTHENTICATED,
  AUTHENTICATED,
}

export interface AuthSliceData {
  user?: AppUser;
  uid: string;
  status: AUTH_STATE;
  userNameDialogOpen: boolean;
  userDoc?: UserDocument;
}

export interface AuthSliceActions {
  subscribe: () => Unsubscribe;
  subscribeToUser: (uid: string) => Unsubscribe;
  closeUserNameDialog: () => void;
  updateUserDoc: (doc: UpdateData<UserDocument>) => void;
}

export type AuthSlice = AuthSliceData & AuthSliceActions;
