import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { initializeAppCheck, ReCaptchaV3Provider } from "firebase/app-check";

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

// Chiave del sito reCAPTCHA v3 per App Check (è pubblica, va bene nel codice).
// Vuota = App Check spento. Vedi GUIDA-SICUREZZA.md, fase 1.
const APP_CHECK_SITE_KEY = "6LdLyykuAAAAAPoroWCaNPD0fZ0_2nwpLv4qKwLs";

const app = initializeApp(firebaseConfig);

if (APP_CHECK_SITE_KEY) {
  try {
    initializeAppCheck(app, { provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY), isTokenAutoRefreshEnabled: true });
  } catch (err) {
    console.warn("App Check non attivo", err);
  }
}

export const db = getDatabase(app);
export const auth = getAuth(app);

// Login anonimo: ogni telefono riceve un'identità Firebase invisibile (nessun dato
// personale, nessuna schermata), che le regole del database possono riconoscere.
// Resta salvata nel browser: al riavvio si ritrova la stessa.
export const authReady = new Promise((resolve) => {
  const stop = onAuthStateChanged(auth, (user) => {
    if (user) { stop(); resolve(user); return; }
    signInAnonymously(auth).catch((err) => {
      console.error("Login anonimo non riuscito", err);
      stop();
      resolve(null);
    });
  });
});
