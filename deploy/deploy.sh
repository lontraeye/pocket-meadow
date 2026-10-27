#!/usr/bin/env bash
# Build local e publicação na VM. Rodar da raiz do repositório:
#   deploy/deploy.sh          → deploy
#   deploy/deploy.sh setup    → prepara a VM (uma vez) e depois faz o deploy
# Cada deploy vira /opt/pocket-meadow/releases/<data>-<commit>, e
# /opt/pocket-meadow/current aponta para ele. Se a API não subir, volta para o
# anterior. O banco fica em /var/lib/pocket-meadow e nunca é tocado aqui; o
# próprio servidor faz backup antes de migrar (PLANNING.md, seção 4.6).
set -euo pipefail
cd "$(dirname "$0")/.."

vm="${POCKET_VM:-ubuntu@147.15.58.105}"
key="${POCKET_KEY:-$HOME/.ssh/oracle_tibiawalk}"
ssh_vm() { ssh -i "$key" -o IdentitiesOnly=yes "$vm" "$@"; }

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Há mudanças sem commit. O deploy publica só o que está commitado." >&2
  exit 1
fi
release="$(date -u +%Y%m%d-%H%M%S)-$(git rev-parse --short HEAD)"

echo "== build"
(cd server && npm run build)
(cd web && npm run build)

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
mkdir -p "$stage/server" "$stage/web"
cp -r server/dist server/drizzle server/snapshots server/package.json server/package-lock.json "$stage/server/"
cp -r web/dist/. "$stage/web/"

if [[ "${1:-}" == "setup" ]]; then
  echo "== setup da VM"
  ssh_vm 'rm -rf /tmp/pocket-meadow-deploy && mkdir -p /tmp/pocket-meadow-deploy'
  tar -C deploy -cf - . | ssh_vm 'tar -C /tmp/pocket-meadow-deploy -xf -'
  ssh_vm 'bash -s' < deploy/setup-vm.sh
fi

echo "== envio de $release"
tar -C "$stage" -czf - . | ssh_vm "sudo mkdir -p /opt/pocket-meadow/releases/$release && sudo tar -C /opt/pocket-meadow/releases/$release -xzf -"

echo "== instalação e troca"
ssh_vm "bash -s" <<REMOTE
set -euo pipefail
base=/opt/pocket-meadow
cd \$base/releases/$release/server
sudo npm ci --omit=dev --no-audit --no-fund --loglevel=error
previous=\$(readlink \$base/current || true)
sudo ln -sfn \$base/releases/$release \$base/current.new
sudo mv -T \$base/current.new \$base/current
sudo systemctl restart pocket-meadow
for i in \$(seq 1 30); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    echo "API no ar ($release)"
    # Guarda as 3 últimas versões para poder voltar.
    ls -1d \$base/releases/* | sort | head -n -3 | xargs -r sudo rm -rf
    exit 0
  fi
  sleep 1
done
echo "A API não subiu. Últimas linhas do log:" >&2
sudo journalctl -u pocket-meadow -n 40 --no-pager >&2
if [[ -n "\$previous" ]]; then
  sudo ln -sfn "\$previous" \$base/current.new
  sudo mv -T \$base/current.new \$base/current
  sudo systemctl restart pocket-meadow
  echo "Voltei para \$previous." >&2
fi
exit 1
REMOTE
