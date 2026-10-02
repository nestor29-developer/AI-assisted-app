# Always runs the newest revision of the purge task, and retries for an hour if capacity is short.
resource "aws_scheduler_schedule" "purge" {
  name                         = "${local.prefix}-purge"
  description                  = "Retention purge: expired documents, old audit rows and spent rate-limit counters"
  schedule_expression          = var.purge_schedule
  schedule_expression_timezone = "UTC"

  flexible_time_window {
    mode = "OFF"
  }

  target {
    arn      = aws_ecs_cluster.main.arn
    role_arn = aws_iam_role.scheduler.arn

    ecs_parameters {
      task_definition_arn = aws_ecs_task_definition.purge.arn_without_revision
      launch_type         = "FARGATE"
      platform_version    = "LATEST"
      task_count          = 1

      network_configuration {
        subnets          = aws_subnet.private[*].id
        security_groups  = [aws_security_group.app.id]
        assign_public_ip = false
      }
    }

    retry_policy {
      maximum_retry_attempts       = 3
      maximum_event_age_in_seconds = 3600
    }
  }
}
