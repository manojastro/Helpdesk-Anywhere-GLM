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
  description = "coturn static-auth-secret (stored in Secret Manager + VM metadata)"
  type        = string
  sensitive   = true
}

variable "jwt_secret" {
  description = "JWT signing secret for the backend (stored in Secret Manager)"
  type        = string
  sensitive   = true
}
