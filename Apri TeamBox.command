#!/bin/zsh
# Avviatore per macOS: fai doppio clic su questo file dal Finder.

cd "$(dirname "$0")"

# Se TeamBox è già in esecuzione, apre semplicemente la chat.
if lsof -ti:8000 >/dev/null 2>&1; then
  open "http://localhost:8000"
  exit 0
fi

# Avvia TeamBox, aspetta che sia pronto e solo allora apre il browser.
python3 server.py &
server_pid=$!

for attempt in {1..20}; do
  if curl --silent --head --fail --max-time 1 "http://localhost:8000" >/dev/null 2>&1; then
    open "http://localhost:8000"
    wait "$server_pid"
    exit 0
  fi
  sleep 0.25
done

echo "TeamBox non è riuscito ad avviarsi."
wait "$server_pid"
