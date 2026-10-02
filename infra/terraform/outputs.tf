output "alb_dns_name" {
  description = "Point the app's DNS name (an alias or CNAME record) at this."
  value       = aws_lb.main.dns_name
}

output "ecr_repository_urls" {
  description = "Where to push the images: the runner target to app, the migrator target to migrator."
  value       = { for key, repository in aws_ecr_repository.this : key => repository.repository_url }
}

output "secret_names" {
  description = "Secrets to fill with `aws secretsmanager put-secret-value` before the first migration."
  value = {
    jwt_secret      = aws_secretsmanager_secret.jwt.name
    gemini_api_key  = aws_secretsmanager_secret.gemini.name
    app_db_password = aws_secretsmanager_secret.app_db.name
  }
}

output "database_endpoint" {
  description = "Private endpoint of the database (only reachable from inside the VPC)."
  value       = aws_db_instance.main.address
}

output "cluster_name" {
  description = "ECS cluster that runs the app, the migration task and the purge task."
  value       = aws_ecs_cluster.main.name
}

output "migration_command" {
  description = "Starts the migration task. Wait for it to stop with exit code 0 before the app rolls out."
  value = join(" ", [
    "aws ecs run-task --region ${var.region} --cluster ${aws_ecs_cluster.main.name} --launch-type FARGATE",
    "--task-definition ${aws_ecs_task_definition.migrate.family}",
    "--network-configuration 'awsvpcConfiguration={subnets=[${join(",", aws_subnet.private[*].id)}],securityGroups=[${aws_security_group.app.id}],assignPublicIp=DISABLED}'",
  ])
}
