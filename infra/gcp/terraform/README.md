# GCP Infrastructure (POC-minimal)

Single-region, POC-sized resources. Nothing here is production-grade by design
(see `docs/POC_SCOPE.md`).

## Layout

- `../backend.Dockerfile` — Cloud Run container for the NestJS backend
- `../coturn/startup.sh` — Compute Engine startup script installing coturn
- `main.tf` — Cloud SQL Postgres, Secret Manager, Cloud Run, coturn VM, firewall

## Deploy (requires gcloud + terraform + billing-enabled project)

```bash
# 1. Backend image
gcloud builds submit \
  --tag "${REGION}-docker.pkg.dev/${PROJECT}/helpdesk/backend" \
  -f infra/gcp/backend.Dockerfile infra/gcp

# 2. Plan + apply
cd infra/gcp/terraform
terraform init
terraform apply \
  -var="project_id=${PROJECT}" \
  -var="region=${REGION}" \
  -var="backend_image=${REGION}-docker.pkg.dev/${PROJECT}/helpdesk/backend" \
  -var="db_password=$(openssl rand -hex 16)" \
  -var="turn_secret=$(openssl rand -hex 16)" \
  -var="jwt_secret=$(openssl rand -hex 32)"
```

Outputs: backend URL + TURN address. Set the same TURN secret as the agent's
`TURN_CREDENTIAL` and username `helpdesk`.

## TURN notes

coturn uses the **long-term credential mechanism** with a single static user
(`user=helpdesk:<turn_secret>` in `../coturn/startup.sh`). That matches the
static `TURN_USERNAME`/`TURN_CREDENTIAL` pair the backend serves from
`GET /config/ice`.

Do not add `use-auth-secret`/`static-auth-secret` to the coturn config unless
you also change the backend: those select the TURN REST scheme, where coturn
expects a time-limited username of `<unix-expiry>:<name>` and a base64
HMAC-SHA1 credential, and every allocation from the current backend would be
rejected.

`TURN_URL` is a comma-separated list, and each entry must carry its scheme —
`turn:HOST:3478?transport=tcp,turns:HOST:443?transport=tcp`. The backend drops
entries with any other scheme and logs a warning, because a malformed URL makes
the browser's `RTCPeerConnection` constructor throw and no session can open.

### `turns:` needs a real certificate

`startup.sh` generates a self-signed certificate so coturn's TLS listener
starts, but **browsers validate the TURN server's certificate**, so `turns:443`
will not work with it. For TLS relay, issue a CA-signed certificate (Let's
Encrypt) for a DNS name pointing at the coturn VM and publish that hostname in
`TURN_URL`. `turn:<ip>:3478?transport=tcp` needs no certificate and is the
working POC fallback path.

## Notes / known POC shortcuts

- Cloud SQL uses public IP + SSL + authorized networks (0.0.0.0/0) — move to
  private IP + VPC connector before any real usage.
- Cloud Run is pinned to `max_instance_count = 1` with `session_affinity`
  because signalling room state is an in-memory Map. Lifting the cap requires
  moving that state to Redis (or the socket.io Redis adapter) first.
- TURN relay port range is narrowed (49160-49200) for POC firewall simplicity.
