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
`TURN_CREDENTIAL` and username `helpdesk` (or generate time-limited REST
credentials server-side for production).

## Notes / known POC shortcuts

- Cloud SQL uses public IP + SSL + authorized networks (0.0.0.0/0) — move to
  private IP + VPC connector before any real usage.
- coturn TLS uses a self-signed cert; browsers require a CA-signed cert for
  `turns:` — use Let's Encrypt/certbot on a DNS name for the real forced-RELAY
  test over TLS.
- TURN relay port range is narrowed (49160-49200) for POC firewall simplicity.
