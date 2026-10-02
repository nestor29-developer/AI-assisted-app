locals {
  # The app and the purge task must agree on this: it decides when an unfinished request counts as abandoned.
  llm_timeout_ms = 60000

  # Cloud-side check of Fargate's allowed CPU and memory pairs, so a typo fails at plan time.
  fargate_memory = {
    "256"  = [512, 1024, 2048]
    "512"  = range(1024, 4097, 1024)
    "1024" = range(2048, 8193, 1024)
    "2048" = range(4096, 16385, 1024)
    "4096" = range(8192, 30721, 1024)
  }

  # Read-only root filesystem, no capabilities, a real init process, and one writable scratch volume.
  container_hardening = {
    essential              = true
    readonlyRootFilesystem = true
    linuxParameters = {
      initProcessEnabled = true
      capabilities       = { drop = ["ALL"] }
    }
    mountPoints = [{ sourceVolume = "tmp", containerPath = "/tmp", readOnly = false }]
  }

  database_environment = [
    { name = "PGHOST", value = aws_db_instance.main.address },
    { name = "PGPORT", value = tostring(aws_db_instance.main.port) },
    { name = "PGDATABASE", value = local.db_name },
    { name = "DATABASE_SSL", value = "true" },
    { name = "HOME", value = "/tmp" },
  ]

  log_options = {
    for name in keys(local.tasks) : name => {
      awslogs-group         = aws_cloudwatch_log_group.task[name].name
      awslogs-region        = var.region
      awslogs-stream-prefix = name
    }
  }

  runtime_platform = {
    operating_system_family = "LINUX"
    cpu_architecture        = var.cpu_architecture
  }
}

resource "aws_ecs_cluster" "main" {
  name = local.prefix

  setting {
    name  = "containerInsights"
    value = var.container_insights ? "enabled" : "disabled"
  }
}

resource "aws_ecs_task_definition" "app" {
  family                   = "${local.prefix}-app"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = aws_iam_role.execution["app"].arn
  skip_destroy             = true

  runtime_platform {
    operating_system_family = local.runtime_platform.operating_system_family
    cpu_architecture        = local.runtime_platform.cpu_architecture
  }

  volume {
    name = "tmp"
  }

  container_definitions = jsonencode([
    merge(local.container_hardening, {
      name         = "app"
      image        = "${aws_ecr_repository.this["app"].repository_url}:${var.image_tag}"
      stopTimeout  = 120
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]

      environment = concat(local.database_environment, [
        { name = "PGUSER", value = var.app_db_user },
        { name = "APP_ORIGIN", value = var.app_origin },
        { name = "TRUSTED_PROXY_HOPS", value = "1" },
        { name = "LLM_PROVIDER", value = "gemini" },
        { name = "LLM_MODEL", value = var.llm_model },
        { name = "LLM_TIMEOUT_MS", value = tostring(local.llm_timeout_ms) },
        { name = "DB_POOL_MAX", value = tostring(var.db_pool_max) },
        { name = "DAILY_TOKEN_BUDGET", value = tostring(var.daily_token_budget) },
        { name = "DATA_RETENTION_DAYS", value = tostring(var.data_retention_days) },
        { name = "AI_REQUEST_RETENTION_DAYS", value = tostring(var.ai_request_retention_days) },
      ])

      secrets = [
        { name = "JWT_SECRET", valueFrom = aws_secretsmanager_secret.jwt.arn },
        { name = "GEMINI_API_KEY", valueFrom = aws_secretsmanager_secret.gemini.arn },
        { name = "PGPASSWORD", valueFrom = aws_secretsmanager_secret.app_db.arn },
      ]

      healthCheck = {
        command     = ["CMD", "node", "-e", "fetch('http://127.0.0.1:3000/api/v1/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
        interval    = 15
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }

      logConfiguration = { logDriver = "awslogs", options = local.log_options["app"] }
    })
  ])

  lifecycle {
    precondition {
      condition     = contains(lookup(local.fargate_memory, tostring(var.cpu), []), var.memory)
      error_message = "Fargate does not offer ${var.cpu} CPU units with ${var.memory} MiB. See the task size table in the ECS documentation."
    }
  }
}

# Applies the SQL migrations and creates the app's database login. Run once per release, before the app rolls out.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.prefix}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution["migrate"].arn
  skip_destroy             = true

  runtime_platform {
    operating_system_family = local.runtime_platform.operating_system_family
    cpu_architecture        = local.runtime_platform.cpu_architecture
  }

  volume {
    name = "tmp"
  }

  container_definitions = jsonencode([
    merge(local.container_hardening, {
      name  = "migrate"
      image = "${aws_ecr_repository.this["migrator"].repository_url}:${local.migrator_tag}"

      environment = concat(local.database_environment, [
        { name = "PGUSER", value = local.db_master_username },
        { name = "APP_DB_USER", value = var.app_db_user },
      ])

      secrets = [
        { name = "PGPASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
        { name = "APP_DB_PASSWORD", valueFrom = aws_secretsmanager_secret.app_db.arn },
      ]

      logConfiguration = { logDriver = "awslogs", options = local.log_options["migrate"] }
    })
  ])
}

# Daily retention purge. It connects as the app's login, never as the master user.
resource "aws_ecs_task_definition" "purge" {
  family                   = "${local.prefix}-purge"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution["purge"].arn
  skip_destroy             = true

  runtime_platform {
    operating_system_family = local.runtime_platform.operating_system_family
    cpu_architecture        = local.runtime_platform.cpu_architecture
  }

  volume {
    name = "tmp"
  }

  container_definitions = jsonencode([
    merge(local.container_hardening, {
      name    = "purge"
      image   = "${aws_ecr_repository.this["migrator"].repository_url}:${local.migrator_tag}"
      command = ["node_modules/.bin/tsx", "--conditions=react-server", "scripts/purge-expired.ts"]

      environment = concat(local.database_environment, [
        { name = "PGUSER", value = var.app_db_user },
        { name = "AI_REQUEST_RETENTION_DAYS", value = tostring(var.ai_request_retention_days) },
        { name = "LLM_TIMEOUT_MS", value = tostring(local.llm_timeout_ms) },
      ])

      secrets = [
        { name = "PGPASSWORD", valueFrom = aws_secretsmanager_secret.app_db.arn },
      ]

      logConfiguration = { logDriver = "awslogs", options = local.log_options["purge"] }
    })
  ])
}

resource "aws_ecs_service" "app" {
  count = var.deploy_service ? 1 : 0

  name             = "app"
  cluster          = aws_ecs_cluster.main.id
  task_definition  = aws_ecs_task_definition.app.arn
  desired_count    = var.desired_count
  launch_type      = "FARGATE"
  platform_version = "LATEST"
  propagate_tags   = "SERVICE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60
  wait_for_steady_state              = true

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }

  # Autoscaling owns the task count after the first apply.
  lifecycle {
    ignore_changes = [desired_count]
  }

  depends_on = [aws_lb_listener.https]
}
