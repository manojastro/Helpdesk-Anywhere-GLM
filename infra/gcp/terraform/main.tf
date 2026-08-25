# Helpdesk Anywhere POC — minimal GCP infrastructure.
# Deliberately POC-sized: single-region, single instances, no HA.
# Plan/apply requires gcloud auth; nothing is created by this repo automatically.

terraform {
  required_version = ">= 1.6"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.40"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

# ---- Cloud SQL (PostgreSQL) ----

resource "google_sql_database_instance" "backend" {
  name             = "helpdesk-poc-db"
  database_version = "POSTGRES_16"
  settings {
    tier = "db-f1-micro" # smallest practical for POC
    ip_configuration {
      ipv4_enabled = true
      # Cloud Run connects via the Serverless Access or public IP + SSL.
      # POC: authorized networks limited to Cloud Run egress via connector is
      # overkill; use private-path via vpc when moving past POC.
      authorized_networks {
        name = "cloud-run-egress"
        # Closed by default (see var.db_authorized_network). Widen it only to
        # the specific address you connect from; the DB still requires SSL +
        # password, but a publicly reachable Postgres port is not acceptable
        # even for a POC.
        value = var.db_authorized_network
      }
      require_ssl = true
    }
  }
  deletion_protection = false
}

resource "google_sql_database" "app" {
  name     = "helpdesk"
  instance = google_sql_database_instance.backend.name
}

resource "google_sql_user" "app" {
  name     = "helpdesk"
  instance = google_sql_database_instance.backend.name
  password = var.db_password
}

resource "google_secret_manager_secret" "db_password" {
  secret_id = "helpdesk-db-password"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "db_password" {
  secret      = google_secret_manager_secret.db_password.id
  secret_data = var.db_password
}

resource "google_secret_manager_secret" "turn_secret" {
  secret_id = "helpdesk-turn-secret"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "turn_secret" {
  secret      = google_secret_manager_secret.turn_secret.id
  secret_data = var.turn_secret
}

resource "google_secret_manager_secret" "jwt_secret" {
  secret_id = "helpdesk-jwt-secret"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "jwt_secret" {
  secret      = google_secret_manager_secret.jwt_secret.id
  secret_data = var.jwt_secret
}

# ---- Cloud Run (backend) ----
# Build & push the image first:
#   gcloud builds submit --tag "${var.region}-docker.pkg.dev/${var.project_id}/helpdesk/backend" -f infra/gcp/backend.Dockerfile infra/gcp

resource "google_artifact_registry_repository" "repo" {
  location      = var.region
  repository_id = "helpdesk"
  format        = "DOCKER"
}

resource "google_cloud_run_v2_service" "backend" {
  name     = "helpdesk-backend"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  # socket.io needs the technician and the endpoint agent on the SAME instance:
  # room occupancy lives in an in-memory Map (SessionRoomsService), so peers on
  # different instances never see each other, and the polling transport needs
  # sticky routing regardless.
  #
  # Raising max_instance_count above 1 REQUIRES moving room state off the
  # process first — Redis, or the socket.io Redis adapter — otherwise sessions
  # break as soon as Cloud Run scales out.
  template {
    session_affinity = true

    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }

    containers {
      image = var.backend_image

      env {
        name  = "DATABASE_URL"
        value = "postgresql://helpdesk:${var.db_password}@${google_sql_database_instance.backend.public_ip_address}:5432/helpdesk?sslmode=require"
      }
      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.jwt_secret.secret_id
            version = "latest"
          }
        }
      }
      env {
        name  = "TURN_URL"
        value = "turn:${google_compute_address.turn.address}:3478?transport=tcp,turns:${google_compute_address.turn.address}:443?transport=tcp"
      }
      env {
        name  = "TURN_USERNAME"
        value = "helpdesk"
      }
      env {
        name = "TURN_CREDENTIAL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.turn_secret.secret_id
            version = "latest"
          }
        }
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.backend.name
  location = google_cloud_run_v2_service.backend.location
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# ---- Compute Engine (coturn) ----

resource "google_compute_address" "turn" {
  name   = "helpdesk-turn-ip"
  region = var.region
}

resource "google_compute_instance" "turn" {
  name         = "helpdesk-turn"
  machine_type = "e2-small"
  zone         = "${var.region}-b"

  boot_disk {
    initialize_params {
      image = "debian-cloud/debian-12"
    }
  }

  network_interface {
    network = "default"
    access_config {
      nat_ip = google_compute_address.turn.address
    }
  }

  metadata_startup_script = file("${path.module}/../coturn/startup.sh")
  metadata = {
    turn-secret = var.turn_secret
  }

  tags = ["helpdesk-turn"]
}

resource "google_compute_firewall" "turn" {
  name    = "helpdesk-turn-ports"
  network = "default"

  allow {
    protocol = "tcp"
    ports    = ["3478", "443", "49160-49200"]
  }
  allow {
    protocol = "udp"
    ports    = ["3478", "443", "49160-49200"]
  }

  source_ranges = ["0.0.0.0/0"]
  target_tags   = ["helpdesk-turn"]
}
