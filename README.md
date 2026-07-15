# TeamBox

Chat di team online: utenti, canali e messaggi sono gestiti da Supabase.

## Aprire TeamBox

Quando TeamBox sarà pubblicato online, basterà aprire il suo link. Non servirà lasciare acceso il Mac.

## Configurazione Supabase

1. Crea un progetto Supabase.
2. Apri il **SQL Editor**, copia e avvia tutto il contenuto di `supabase_schema.sql`.
3. In **Connect**, copia l’URL del progetto e la chiave pubblica (*Publishable key*).
4. Inseriscili in `config.js`.

Non inserire mai una chiave `service_role` nell’app: deve restare privata.

## Accesso privato del team

TeamBox non mostra la registrazione autonoma. In Supabase apri **Authentication → Settings → General configuration** e disattiva **Allow new users to sign up**. Per invitare una persona usa **Authentication → Users → Add user → Send invitation**.

## Versione locale precedente

Nella cartella del progetto esegui:

```bash
python3 server.py
```

Poi apri [http://localhost:8000](http://localhost:8000). Per consentire al team di collegarsi dalla stessa rete, avvia il server su un computer raggiungibile e apri dal browser degli altri dispositivi `http://IP-DEL-COMPUTER:8000`.

Il vecchio server Python resta disponibile soltanto per provare la versione locale.
