#!/usr/bin/env bash
# coturn TURN server for Helpdesk Anywhere POC (Compute Engine startup script).
# Provide instance metadata when creating the VM:
#   turn-secret: the shared TURN credential
#   external-ip: the VM's external IP (set automatically below if empty)
set -euo pipefail

SECRET=$(curl -s -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/attributes/turn-secret")
EXTERNAL_IP=$(curl -s -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip")

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y coturn

# TLS cert via Google's managed ACME DNS plugin ( simplest POC path) or self-signed.
# Browsers require a valid cert for turns: (TURN over TLS).
mkdir -p /etc/turn
if [ ! -f /etc/turn/tls-cert.pem ]; then
  apt-get install -y certbot
  # POC: self-signed cert is ACCEPTED by Chromium for turns: when the CA is not
  # validated against TURN (browsers do validate — for real deployments use a
  # Let's Encrypt cert; documented in docs/turn-deployment.md).
  openssl req -x509 -newkey rsa:2048 -keyout /etc/turn/tls-key.pem -out /etc/turn/tls-cert.pem \
    -days 365 -nodes -subj "/CN=${EXTERNAL_IP}"
fi

cat > /etc/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=443
external-ip=${EXTERNAL_IP}
fingerprint
lt-cred-mech
use-auth-secret
static-auth-secret=${SECRET}
realm=helpdesk.example.com
cert=/etc/turn/tls-cert.pem
pkey=/etc/turn/tls-key.pem
no-multicast-peers
no-cli
no-tlsv1
no-tlsv1_1
min-port=49160
max-port=49200
log-file=/var/log/turnserver.log
simple-log
EOF

systemctl enable coturn
systemctl restart coturn
echo "coturn running: 3478/udp+tcp, 443/tcp+udp (TLS)"
