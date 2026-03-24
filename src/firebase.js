import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

// ╔══════════════════════════════════════════════════════════╗
// ║  INSERISCI QUI LA TUA CONFIGURAZIONE FIREBASE           ║
// ║  Segui la guida GUIDA-SETUP.md per ottenerla            ║
// ╚══════════════════════════════════════════════════════════╝

const firebaseConfig = {
  apiKey: "AIzaSyDfdsnyQ7gko4fQKp4unUJ1-HUK_IDxJuU",
  authDomain: "fazi-league.firebaseapp.com",
  databaseURL: "https://fazi-league-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "fazi-league",
  storageBucket: "fazi-league.firebasestorage.app",
  messagingSenderId: "350372685111",
  appId: "1:350372685111:web:0aa59fa3bfebe02b1866b2",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
