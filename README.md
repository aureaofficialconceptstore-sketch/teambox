# TeamBox

Chat di team online: utenti, canali e messaggi sono gestiti da Supabase.

## Pubblicazione online

TeamBox include la pubblicazione automatica tramite GitHub Pages. Dopo aver caricato il progetto su GitHub:

1. Apri **Settings → Pages** del repository e, in **Source**, scegli **GitHub Actions**.
2. L’azione `Publish TeamBox` pubblicherà automaticamente ogni aggiornamento del ramo `main`.
3. Il link finale sarà `https://aureaofficialconceptstore-sketch.github.io/teambox/`.
4. In Supabase, apri **Authentication → URL Configuration** e imposta quel link sia come **Site URL** sia fra le **Redirect URLs**. Così gli inviti e i link di accesso riportano alla versione online, non a `localhost`.

Il file `config.js` contiene soltanto la chiave pubblica di Supabase, quindi può restare nella versione pubblicata. Non inserire mai una chiave `service_role` nell’app.

## Configurazione Supabase

1. Crea un progetto Supabase.
2. Apri il **SQL Editor**, copia e avvia tutto il contenuto di `supabase_schema.sql`.
3. Subito dopo, copia e avvia tutto il contenuto di `supabase_features.sql`: abilita messaggi diretti e condivisione file.
4. In **Connect**, copia l’URL del progetto e la chiave pubblica (*Publishable key*).
5. Inseriscili in `config.js`.

## Accesso privato del team

TeamBox non mostra la registrazione autonoma. In Supabase apri **Authentication → Settings → General configuration** e disattiva **Allow new users to sign up**. Per invitare una persona usa **Authentication → Users → Add user → Send invitation**.

## Versione locale precedente

Nella cartella del progetto esegui:

```bash
python3 server.py
```

Poi apri [http://localhost:8000](http://localhost:8000). Per consentire al team di collegarsi dalla stessa rete, avvia il server su un computer raggiungibile e apri dal browser degli altri dispositivi `http://IP-DEL-COMPUTER:8000`.

Il vecchio server Python resta disponibile soltanto per provare la versione locale.

## Funzioni disponibili

- Canali e messaggi in tempo reale
- Ricerca canali e scelta delle persone che possono entrarci
- Messaggi diretti tra membri del team
- Condivisione di file fino a 25 MB nei canali
- Ricerca nei messaggi dei canali
- Canvas privato nelle chat 1:1, con note e tabelle condivise
- Videochiamata di gruppo per canale: apre una stanza Meet in una nuova scheda
- Calendario condiviso: eventi e videochiamate pianificate per il team o un canale
