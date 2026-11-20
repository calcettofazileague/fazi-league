# 🔒 FAZI LEAGUE — Pulizia del database e secondo passo di sicurezza

Tutto si fa dalla console Firebase: https://console.firebase.google.com → progetto **fazi-league**.
Le fasi vanno fatte **in ordine**: se le regole nuove arrivano prima dell'app nuova (o il contrario) l'admin resta chiuso fuori.

| Fase | Cosa | Chi | Gli utenti se ne accorgono? |
|---|---|---|---|
| 0 | Pulizia dei nodi vecchi | tu | no |
| 1 | Login anonimo, App Check in prova, regola per la sessione admin | tu | no |
| 2 | Pubblicazione dell'app nuova | Claude, quando gli dici che la fase 1 è fatta | no |
| 3 | Regole più strette (dopo 2–3 giorni) | tu, con il testo preparato da Claude | no |
| 4 | App Check obbligatorio (facoltativo, dopo 1–2 settimane) | tu | no |

---

## FASE 0 — Pulizia dei nodi vecchi

La console Firebase non è soggetta alle regole: puoi cancellare anche con la radice chiusa.
L'app non usa più `fieldStatus`, `presenzeContate` né le chiavi a forma di data (verificato nel codice): usa solo settimane nel formato `2026-W46`.

1. **Backup prima di tutto.** Menu a sinistra → **Realtime Database** → scheda **Dati** → **⋮** (in alto a destra della tabella) → **Esporta JSON**. Conserva il file con la data di oggi nel nome.
2. Passa il mouse su **`fieldStatus`** → icona **cestino** (o **⋮ → Elimina**) → conferma.
3. Stessa cosa per **`presenzeContate`**.
4. Apri **`signups`**: elimina le **4 chiavi a forma di data** (tipo `2025-11-17`). **Non toccare** quelle tipo `2026-W46`.
5. Dai un'occhiata anche a **`signupMeta`** e **`teams`**: se ci sono chiavi a forma di data, eliminale allo stesso modo.
6. Se nelle **Regole** ci sono blocchi per `fieldStatus` o `presenzeContate`, toglili e premi **Pubblica**.

Se qualcosa va storto: **⋮ → Importa JSON** sul punto giusto con il backup.

---

## FASE 1 — Preparare Firebase

Niente di questo cambia l'app di oggi: serve solo a preparare il terreno.

### 1.1 Login anonimo
1. Menu a sinistra → **Authentication** → **Inizia** (se è la prima volta).
2. Scheda **Metodo di accesso** → **Anonimo** → attiva → **Salva**.

Ogni telefono riceverà un'identità Firebase invisibile: nessuna schermata di login, nessun dato personale. Serve alle regole per riconoscere "chi" scrive, a partire dalla sessione admin.

### 1.2 App Check in modalità monitoraggio
App Check verifica che le richieste arrivino dalla tua app e non da script. In **monitoraggio** registra soltanto, non blocca nulla.

1. Crea una chiave reCAPTCHA v3: https://www.google.com/recaptcha/admin/create
   - **Tipo**: basato su punteggio (**v3**)
   - **Domini**: il dominio dell'app su Vercel (es. `fazi-league.vercel.app`) ed eventuale dominio personalizzato
   - Ti dà due chiavi: **chiave del sito** (pubblica) e **chiave segreta**.
   - ⚠️ Se a un certo punto ti chiede di **attivare la fatturazione**, fermati e dimmelo: App Check è un extra e si può rimandare senza problemi.
2. Console Firebase → **App Check** → scheda **App** → la web app → **reCAPTCHA** → incolla la **chiave segreta** → **Salva**.
3. **Non** premere **Applica** su Realtime Database: deve restare in monitoraggio.
4. **Mandami la chiave del sito** (quella pubblica): la inserisco io in `src/firebase.js`.

### 1.3 Regola per la sessione admin
Da ora l'app non legge più l'impronta del PIN: per entrare come admin scrive una "sessione" con l'impronta calcolata dal PIN digitato, e **sono le regole** a dire se è giusta.

Realtime Database → **Regole** → aggiungi questo blocco dentro `"rules": { … }`, accanto agli altri nodi (attento alla virgola prima) → **Pubblica**:

```json
"adminSessions": {
  "$uid": {
    ".read": "auth != null && auth.uid === $uid",
    ".write": "auth != null && auth.uid === $uid",
    ".validate": "newData.hasChildren(['hash', 't']) && newData.child('hash').val() === root.child('config/adminPin/hash').val() && newData.child('t').val() === now",
    "hash": { ".validate": "newData.isString()" },
    "t": { ".validate": "newData.isNumber()" },
    "$other": { ".validate": false }
  }
}
```

È un'aggiunta: l'app di oggi non usa questo nodo e continua a funzionare uguale.

👉 **Quando hai fatto 1.1, 1.2 e 1.3, dimmelo** (con la chiave del sito, se l'hai creata).

---

## FASE 2 — App nuova (la pubblico io)

Cosa cambia nell'app (il codice è già pronto sul branch `claude/jolly-allen-0fsqur`):
- all'avvio fa il **login anonimo** e solo dopo legge i dati;
- se c'è la chiave del sito, attiva **App Check**;
- l'accesso admin **non legge più l'impronta del PIN**: apre la sessione in `adminSessions` e, se le regole la rifiutano, il PIN è sbagliato. Uscendo da admin la sessione viene chiusa.

Dopo la pubblicazione, controlla:
1. Apri l'app, 5 tocchi sullo stemma, PIN → deve entrare in admin.
2. **Authentication → Utenti**: compaiono utenti "anonimi" man mano che la gente apre l'app.
3. **App Check → Realtime Database**: compaiono richieste "verificate".

Poi **aspetta 2–3 giorni**, così quasi tutti i telefoni aprono l'app e prendono la versione nuova.

---

## FASE 3 — Regole più strette

**Incollami in chat le regole attuali** (Realtime Database → Regole, copia tutto: non contengono segreti). Ti restituisco il testo completo da incollare, che mantiene le tue validazioni e aggiunge:

- lettura e scrittura **solo con il login anonimo** (`auth != null`) su tutti i nodi;
- `config/adminPin`: si legge **solo il sale** (`salt`), **l'impronta non è più leggibile**; si scrive solo da admin, o se il PIN non esiste ancora;
- `playerStats`, `matchHistory`, `ratingAdjust`, `teams`: scrittura **solo da admin**;
- `logs`: aggiunta per tutti (come ora), lettura **solo da admin**.

"Admin" nelle regole significa:
```
auth != null && root.child('adminSessions/' + auth.uid + '/hash').val() === root.child('config/adminPin/hash').val()
```

Dopo la pubblicazione:
1. Prova da un telefono normale: iscrizione e cancellazione funzionano, le pagine si caricano.
2. Prova da admin: registra o modifica qualcosa e poi **Annulla**.
3. **Cambia il PIN admin** (barra admin → 🔑 PIN), con almeno 8 caratteri tra lettere e numeri. L'impronta del PIN di oggi era leggibile da chiunque, quindi va considerata scoperta. Gli altri telefoni admin dovranno inserire il PIN nuovo.

Se qualcosa non va: Regole → incolla quelle di prima → **Pubblica** (tienile da parte prima di cambiarle).

---

## FASE 4 — App Check obbligatorio (facoltativo)

Dopo 1–2 settimane: **App Check → Realtime Database** → guarda le metriche.
- Se le richieste sono quasi tutte **verificate** → premi **Applica**: da lì in poi solo l'app può parlare con il database.
- Se ci sono molte richieste **non verificate** (browser vecchi, app aperte dentro WhatsApp) → lascia in monitoraggio e dimmelo.

---

## Costi (piano Spark)
- Login anonimo e App Check: gratuiti.
- reCAPTCHA v3: ha una quota gratuita mensile, ampiamente sufficiente per un gruppo di calcetto; controlla comunque cosa indica la pagina di reCAPTCHA quando crei la chiave (vedi l'avviso al punto 1.2).
