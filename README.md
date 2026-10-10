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

## Ambiente demo

La pagina dimostrativa è attivata solo con `VITE_DEMO_MODE=true`; mostra istruzioni d'accesso e un avviso permanente dopo il login. Per pubblicarla, usa un progetto Vercel e un progetto Supabase separati dalla produzione, con account invitati e dati esclusivamente fittizi. Segui [docs/DEMO_SETUP.md](docs/DEMO_SETUP.md): il database iniziale va riconciliato con lo schema completo prima di applicare le migrazioni a un nuovo progetto.

## Prima dell'uso con dati sanitari reali

- Applicare e verificare le migrazioni SQL, inclusa `supabase/migrations/20261009_security_hardening.sql`, su un progetto Supabase di test prima del database operativo.
- Applicare anche `supabase/migrations/20261012_security_privileges.sql` al progetto operativo corretto; la migrazione richiede che siano già state applicate le funzioni create nelle migrazioni precedenti.
- Controllare le policy RLS effettive anche per le tabelle non definite dalle migrazioni presenti in questo repository.
- Verificare separatamente il flusso offline, il ripristino password e la gestione delle modifiche in attesa di sincronizzazione.
- Usare un progetto Supabase separato per le anteprime; non collegare le preview a dati sanitari reali.
- In Supabase Auth, impostare una password minima di almeno 12 caratteri, abilitare MFA almeno per gli amministratori e limitare gli URL di redirect ai domini effettivamente usati.
- Verificare la regione del database, gli accordi sul trattamento dati e i sub-responsabili di Supabase e Vercel; configurare accessi amministrativi individuali e rimuovere quelli non più necessari.
- Definire con il referente privacy informativa, base giuridica, tempi di conservazione, procedure per le richieste degli interessati, DPIA e risposta alle violazioni prima di usare dati identificativi o sanitari.
- Gestire i dispositivi con account individuali, blocco schermo, aggiornamenti e cancellazione remota; la modalità offline conserva dati cifrati nel browser finché vengono sincronizzati e l'utente esce.

La configurazione Vercel non sostituisce la verifica di sicurezza, privacy e conformità necessaria per l'impiego sanitario.

## Controlli tecnici disponibili

- **Registro amministrativo:** la migrazione `20261013_admin_audit.sql` registra chi ha creato, modificato o eliminato impostazioni e configurazioni, oltre alle esportazioni. Memorizza i nomi dei campi cambiati, non i loro valori né i dati clinici.
- **Sincronizzazione offline:** il pannello in alto mostra solo il tipo e l'ora delle modifiche in attesa e un motivo sintetico dell'eventuale errore. Il contenuto resta cifrato nel browser; la cifratura locale non protegge un dispositivo già sbloccato o compromesso.
- **Esportazione per organizzazione:** genera un archivio JSON cifrato con una password scelta dall'amministratore, separato per cliente attivo, e registra l'esportazione. La decifratura avviene localmente nel browser; l'eventuale JSON leggibile va protetto e cancellato dal dispositivo dopo l'uso.
- **Conservazione:** l'amministratore può registrare, per ogni organizzazione, il periodo approvato e vedere gli eventi conclusi da sottoporre a revisione. Non è impostato un periodo predefinito e non parte alcuna cancellazione automatica: durata, base giuridica, eccezioni, copie offline e backup devono essere definite dal titolare con il referente privacy prima di cancellare dati.

Questi controlli non rendono da soli il trattamento conforme al GDPR e non costituiscono una certificazione per dati sanitari. Prima dell'uso reale servono almeno: definizione documentata dei ruoli di titolare/responsabile, basi giuridiche ai sensi degli articoli 6 e 9, informativa, registro dei trattamenti, valutazione d'impatto quando richiesta, accordi con i fornitori e sub-responsabili, localizzazione/trasferimenti, tempi di conservazione e procedura per incidenti e diritti degli interessati. Le copie contenute nei backup dei fornitori e nei dispositivi offline seguono cicli distinti dalla cancellazione applicativa.
