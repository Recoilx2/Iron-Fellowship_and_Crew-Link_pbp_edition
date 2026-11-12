import { UserDocument } from "api-calls/user/_user.type";
import { AppUser } from "api-calls/auth/appUser";
import { DocumentUpdate, Unsubscribe } from "api-calls/helpers.type";

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
  updateUserDoc: (doc: DocumentUpdate<UserDocument>) => void;
}

export type AuthSlice = AuthSliceData & AuthSliceActions;
