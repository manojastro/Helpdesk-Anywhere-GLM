variable "project_id" {
  description = "GCP project id for the POC"
  type        = string
}

variable "region" {
  description = "GCP region (single-region POC)"
  type        = string
  default     = "asia-south1"
}

variable "backend_image" {
  description = "Artifact Registry image for the backend (see backend.Dockerfile)"
  type        = string
}

variable "db_password" {
  description = "PostgreSQL app user password (stored in Secret Manager)"
  type        = string
  sensitive   = true
}

variable "turn_secret" {
  description = "coturn long-term-credential password for user helpdesk (Secret Manager + VM metadata)"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT signing secret for the backend (stored in Secret Manager)"
  type        = string
  sensitive   = true
}

variable "db_authorized_network" {
  description = <<-EOT
    CIDR allowed to reach the Cloud SQL public IP. The default is closed on
    purpose — set it to the address you actually connect from (e.g. your admin
    IP as "203.0.113.4/32"), or move to a private IP + VPC connector, which is
    what any real deployment should do. Never set this to 0.0.0.0/0.
  EOT
  type        = string
  default     = "127.0.0.1/32"
}
