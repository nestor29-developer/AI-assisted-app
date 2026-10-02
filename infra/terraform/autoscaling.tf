resource "aws_appautoscaling_target" "app" {
  count = var.deploy_service ? 1 : 0

  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.app[0].name}"
  min_capacity       = var.min_count
  max_capacity       = var.max_count
}

# Scale in slowly: a task that is removed waits for its streams, so flapping would cut answers short.
resource "aws_appautoscaling_policy" "cpu" {
  count = var.deploy_service ? 1 : 0

  name               = "${local.prefix}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.app[0].service_namespace
  scalable_dimension = aws_appautoscaling_target.app[0].scalable_dimension
  resource_id        = aws_appautoscaling_target.app[0].resource_id

  target_tracking_scaling_policy_configuration {
    target_value       = 60
    scale_out_cooldown = 60
    scale_in_cooldown  = 300

    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}

# Requests per minute per task. Streams are long, so a metric of in-flight streams would track load better.
resource "aws_appautoscaling_policy" "requests" {
  count = var.deploy_service ? 1 : 0

  name               = "${local.prefix}-requests"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.app[0].service_namespace
  scalable_dimension = aws_appautoscaling_target.app[0].scalable_dimension
  resource_id        = aws_appautoscaling_target.app[0].resource_id

  target_tracking_scaling_policy_configuration {
    target_value       = 300
    scale_out_cooldown = 60
    scale_in_cooldown  = 300

    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      resource_label         = "${aws_lb.main.arn_suffix}/${aws_lb_target_group.app.arn_suffix}"
    }
  }
}
