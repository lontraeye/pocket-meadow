#!/usr/bin/env bash
# Prepara a VM uma vez (pode rodar de novo sem estragar nada). Roda NA VM:
#   ssh ... 'bash -s' < deploy/setup-vm.sh
# Precisa dos arquivos de deploy/ em /tmp/pocket-meadow-deploy (o deploy.sh manda).
set -euo pipefail
src=/tmp/pocket-meadow-deploy

if ! command -v node >/dev/null || [[ "$(node -v)" != v24.* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

id pocket-meadow >/dev/null 2>&1 || sudo useradd --system --home /var/lib/pocket-meadow --shell /usr/sbin/nologin pocket-meadow
sudo install -d -o pocket-meadow -g pocket-meadow -m 750 /var/lib/pocket-meadow
sudo install -d -m 755 /opt/pocket-meadow /opt/pocket-meadow/releases

# O .env não é sobrescrito: na VM ele pode ter ganhado ajustes.
[[ -f /etc/pocket-meadow.env ]] || sudo install -m 600 "$src/pocket-meadow.env" /etc/pocket-meadow.env
sudo chmod 600 /etc/pocket-meadow.env
for unit in pocket-meadow.service pocket-meadow-backup.service pocket-meadow-backup.timer; do
  sudo install -m 644 "$src/$unit" "/etc/systemd/system/$unit"
done
sudo systemctl daemon-reload
sudo systemctl enable pocket-meadow.service pocket-meadow-backup.timer
sudo systemctl start pocket-meadow-backup.timer
echo "setup ok: node $(node -v)"
