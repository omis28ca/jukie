#!/bin/bash
# Installs the IrDJ Wi-Fi setup fallback. Run with sudo from anywhere:
#   sudo deploy/wifi-setup/install.sh [server-user]
set -eu
cd "$(dirname "$0")"

SERVER_USER=${1:-${SUDO_USER:-user}}
id "$SERVER_USER" >/dev/null

install -m 0755 irdj-wifi-setup /usr/local/bin/irdj-wifi-setup
install -m 0644 irdj-wifi-setup.service /etc/systemd/system/irdj-wifi-setup.service
sed "s/@SERVER_USER@/$SERVER_USER/" 50-irdj-network.rules >/etc/polkit-1/rules.d/50-irdj-network.rules
chmod 0644 /etc/polkit-1/rules.d/50-irdj-network.rules

install -d -m 0755 /etc/irdj
if [ ! -f /etc/irdj/wifi-setup.conf ]; then
  password=$(tr -dc 'a-km-z2-9' </dev/urandom | head -c 10)
  cat >/etc/irdj/wifi-setup.conf <<CONF
# IrDJ Wi-Fi setup hotspot (see deploy/wifi-setup in the IrDJ repo)
HOTSPOT_SSID=IrDJ-Setup
HOTSPOT_PASSWORD=$password
SERVER_USER=$SERVER_USER
IFACE=wlan0
APP_PORT=3000
OFFLINE_GRACE=90
IDLE_RETRY=300
CONF
  chmod 0600 /etc/irdj/wifi-setup.conf
  echo "Created /etc/irdj/wifi-setup.conf (hotspot password: $password)"
fi

systemctl daemon-reload
systemctl enable --now irdj-wifi-setup.service
echo "irdj-wifi-setup installed for server user $SERVER_USER"
