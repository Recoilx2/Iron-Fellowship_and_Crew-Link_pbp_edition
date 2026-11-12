import { FirebaseOptions, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getFunctions } from "firebase/functions";
import { getSystem } from "hooks/useGameSystem";
import { GAME_SYSTEMS, GameSystemChooser } from "types/GameSystems.type";

const gameSystem = getSystem();
const firebaseConfigs: GameSystemChooser<FirebaseOptions> = {
  [GAME_SYSTEMS.IRONSWORN]: {
    apiKey: import.meta.env.VITE_IRON_FELLOWSHIP_FIREBASE_APIKEY,
    authDomain: import.meta.env.VITE_IRON_FELLOWSHIP_FIREBASE_AUTHDOMAIN,
    projectId: import.meta.env.VITE_IRON_FELLOWSHIP_FIREBASE_PROJECTID,
    storageBucket: import.meta.env.VITE_IRON_FELLOWSHIP_FIREBASE_STORAGEBUCKET,
    messagingSenderId: import.meta.env
      .VITE_IRON_FELLOWSHIP_FIREBASE_MESSAGINGSENDERID,
    appId: import.meta.env.VITE_IRON_FELLOWSHIP_FIREBASE_APPID,
  },
  [GAME_SYSTEMS.STARFORGED]: {
    apiKey: import.meta.env.VITE_CREW_LINK_FIREBASE_APIKEY,
    authDomain: import.meta.env.VITE_CREW_LINK_FIREBASE_AUTHDOMAIN,
    projectId: import.meta.env.VITE_CREW_LINK_FIREBASE_PROJECTID,
    storageBucket: import.meta.env.VITE_CREW_LINK_FIREBASE_STORAGEBUCKET,
    messagingSenderId: import.meta.env
      .VITE_CREW_LINK_FIREBASE_MESSAGINGSENDERID,
    appId: import.meta.env.VITE_CREW_LINK_FIREBASE_APPID,
  },
};

export const projectId = firebaseConfigs[gameSystem].projectId;

const firebaseOptions: FirebaseOptions = {
  ...firebaseConfigs[gameSystem],
  // Spec #11 moves the app off Firebase: sign-in already runs on Supabase
  // and the data areas follow in later tickets. Until then the app must boot
  // without Firebase credentials (the site container ships none, and fresh
  // checkouts have no .env.local), so an unconfigured project gets a
  // placeholder key. Firebase calls fail only if actually reached.
  apiKey: firebaseConfigs[gameSystem].apiKey || "unconfigured",
};

export const firebaseApp = initializeApp(firebaseOptions);

export const firebaseAuth = getAuth(firebaseApp);

export const firestore = getFirestore(firebaseApp);

export const storage = getStorage(firebaseApp);

export const functions = getFunctions(firebaseApp);
