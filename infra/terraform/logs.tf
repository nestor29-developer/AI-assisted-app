# The app logs ids, counts and timings only: never prompts, answers or document text.
resource "aws_cloudwatch_log_group" "task" {
  for_each = toset(keys(local.task_repository))

  name              = "/${local.prefix}/${each.key}"
  retention_in_days = var.log_retention_days
}
