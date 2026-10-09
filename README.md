# VYTA MED

Applicazione web installabile (PWA) per il coordinamento degli interventi sanitari negli stadi. Può lavorare offline dopo il primo accesso e la prima sincronizzazione; i dati locali sono cifrati e vengono inviati a Supabase quando torna la connessione.

## Avvio locale

1. Copia `.env.example` in `.env` e inserisci l'URL del progetto Supabase e la sua chiave anonima.
2. Installa le dipendenze con `npm install`.
3. Avvia l'app con `npm run dev`.

La chiave anonima Supabase viene inclusa nel codice del browser: è previsto. La protezione dei dati deve quindi essere garantita dalle policy RLS del database. Non inserire mai una chiave `service_role` o password nelle variabili `VITE_`.

## Pubblicazione su Vercel

Il progetto usa Vite. In Vercel imposta il framework **Vite**, il comando di build `npm run build` e la cartella di output `dist`. `vercel.json` configura gli URL dell'app a pagina singola e le intestazioni HTTP di sicurezza.

Imposta queste variabili nelle impostazioni del progetto Vercel, per **Preview** e **Production**:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

In Supabase Auth, aggiungi il dominio Vercel scelto e `http://localhost:5173` agli URL di redirect consentiti. Per il recupero password serve anche un servizio email configurato. Dopo aver scelto il dominio definitivo, aggiorna gli URL di redirect e il template email.

## Prima dell'uso con dati sanitari reali

- Applicare e verificare le migrazioni SQL, inclusa `supabase/migrations/20261009_security_hardening.sql`, su un progetto Supabase di test prima del database operativo.
- Controllare le policy RLS effettive anche per le tabelle non definite dalle migrazioni presenti in questo repository.
- Verificare separatamente il flusso offline, il ripristino password e la gestione delle modifiche in attesa di sincronizzazione.
- Usare un progetto Supabase separato per le anteprime; non collegare le preview a dati sanitari reali.

La configurazione Vercel non sostituisce la verifica di sicurezza, privacy e conformità necessaria per l'impiego sanitario.
