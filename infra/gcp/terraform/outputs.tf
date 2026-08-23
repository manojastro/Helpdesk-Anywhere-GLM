output "backend_url" {
  description = "Cloud Run service URL"
  value       = google_cloud_run_v2_service.backend.uri
}

output "turn_address" {
  description = "Public IP of the coturn VM (TURN 3478, TURN/TLS 443)"
  value       = google_compute_address.turn.address
}

output "database_instance" {
  value = google_sql_database_instance.backend.name
}
