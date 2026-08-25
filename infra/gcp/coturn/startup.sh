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

# TLS cert for the tls-listening-port.
#
# IMPORTANT: browsers validate the TURN server's TLS certificate, so the
# self-signed cert generated below does NOT work for turns: from Chromium or
# Firefox — turns:443 allocations will fail. It exists only so coturn's TLS
# listener starts. The working POC path is turn:<ip>:3478?transport=tcp, which
# needs no certificate at all.
#
# To make turns:443 actually work, replace this with a CA-issued certificate
# (e.g. Let's Encrypt via certbot) for a real DNS name pointing at this VM, and
# publish that hostname in TURN_URL instead of the bare IP. See
# infra/gcp/terraform/README.md.
mkdir -p /etc/turn
if [ ! -f /etc/turn/tls-cert.pem ]; then
  openssl req -x509 -newkey rsa:2048 -keyout /etc/turn/tls-key.pem -out /etc/turn/tls-cert.pem \
    -days 365 -nodes -subj "/CN=${EXTERNAL_IP}"
fi

# Auth: long-term credential mechanism with one static user. This matches the
# static TURN_USERNAME/TURN_CREDENTIAL pair the backend serves from
# /config/ice. Do NOT add use-auth-secret/static-auth-secret here — that
# selects the TURN REST scheme, where coturn expects a time-limited
# username of "<unix-expiry>:<name>" and a base64 HMAC-SHA1 credential, and
# every allocation from the current backend would be rejected with a 401.
cat > /etc/turnserver.conf <<EOF
listening-port=3478
tls-listening-port=443
external-ip=${EXTERNAL_IP}
fingerprint
lt-cred-mech
user=helpdesk:${SECRET}
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
echo "coturn running: 3478/udp+tcp (working POC path), 443/tcp+udp (TLS, needs a real cert)"
