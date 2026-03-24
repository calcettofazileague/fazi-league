# 🏆 FAZI LEAGUE — Guida Setup

Segui questi passaggi per mettere online la tua app. Tempo stimato: ~15 minuti.

---

## PASSO 1: Creare il progetto Firebase (database)

1. Vai su https://console.firebase.google.com
2. Clicca **"Aggiungi progetto"** (o "Add project")
3. Nome progetto: `fazi-league` → clicca Continua
4. Disattiva Google Analytics (non serve) → clicca **Crea progetto**
5. Aspetta che si crei, poi clicca **Continua**

### 1b: Attivare il Realtime Database

1. Nel menu a sinistra, clicca **"Crea"** → **"Realtime Database"**
2. Clicca **"Crea database"**
3. Scegli la località più vicina (europe-west1 va bene)
4. Seleziona **"Avvia in modalità test"** → clicca Abilita
   - ⚠️ Questo permette a chiunque con il link di leggere/scrivere i dati per 30 giorni
   - Per il tuo uso (gruppo privato) va benissimo

### 1c: Ottenere la configurazione

1. Vai alla pagina principale del progetto (clicca l'icona casa)
2. Clicca l'icona **`</>`** (Web) per aggiungere un'app web
3. Nome app: `fazi-league` → clicca **Registra app**
4. Ti mostrerà un blocco di codice con `firebaseConfig`. Copia questi valori:
   ```
   apiKey: "AIza..."
   authDomain: "fazi-league-xxxxx.firebaseapp.com"
   databaseURL: "https://fazi-league-xxxxx-default-rtdb.europe-west1.firebasedatabase.app"
   projectId: "fazi-league-xxxxx"
   storageBucket: "fazi-league-xxxxx.appspot.com"
   messagingSenderId: "123456789"
   appId: "1:123456789:web:abc123"
   ```
5. Apri il file `src/firebase.js` e sostituisci tutti i `"INSERISCI_QUI"` con i tuoi valori

---

## PASSO 2: Creare un account GitHub

Se hai già un account GitHub, salta al passo 3.

1. Vai su https://github.com
2. Clicca **Sign up** e crea un account gratuito
3. Conferma l'email

---

## PASSO 3: Caricare il codice su GitHub

1. Vai su https://github.com/new
2. Nome repository: `fazi-league`
3. Lascia tutto il resto com'è → clicca **Create repository**
4. Nella pagina che appare, clicca **"uploading an existing file"**
5. Trascina TUTTI i file e le cartelle del progetto (package.json, src/, index.html, ecc.)
6. Clicca **Commit changes**

---

## PASSO 4: Pubblicare su Vercel

1. Vai su https://vercel.com
2. Clicca **Sign Up** → scegli **Continue with GitHub**
3. Autorizza Vercel ad accedere al tuo GitHub
4. Clicca **"Add New..."** → **"Project"**
5. Trova `fazi-league` nella lista e clicca **Import**
6. Lascia tutte le impostazioni come sono (Vercel rileva Vite automaticamente)
7. Clicca **Deploy**
8. Aspetta 1-2 minuti... e fatto! 🎉

Vercel ti darà un link tipo: `https://fazi-league.vercel.app`

---

## PASSO 5: Condividi su WhatsApp

Copia il link e mandalo nel gruppo WhatsApp. Tutti possono aprirlo dal telefono, iscriversi alle partite, e vedere le squadre in tempo reale!

---

## 🔧 Note utili

### Modalità Admin
Clicca 5 volte velocemente sul logo per attivare la modalità admin (azzera liste, cancella statistiche).

### Sicurezza database
Dopo 30 giorni, Firebase disattiva la modalità test. Per rinnovarla:
1. Vai su Firebase Console → Realtime Database → Regole
2. Cambia la data nella regola oppure metti:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
   Questo permette accesso libero (va bene per un gruppo privato).

### Costi
Tutto è gratis. Firebase e Vercel hanno piani gratuiti più che sufficienti per il tuo uso.

---

Buon divertimento con la Fazi League! ⚽
