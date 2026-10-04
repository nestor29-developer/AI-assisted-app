mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["eu-west-1a", "eu-west-1b", "eu-west-1c"]
    }
  }

  mock_data "aws_caller_identity" {
    defaults = {
      account_id = "111111111111"
    }
  }

  mock_data "aws_partition" {
    defaults = {
      partition = "aws"
    }
  }

  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }

  mock_resource "aws_lb" {
    defaults = {
      arn        = "arn:aws:elasticloadbalancing:eu-west-1:111111111111:loadbalancer/app/mock/0123456789abcdef"
      arn_suffix = "app/mock/0123456789abcdef"
      dns_name   = "mock-123.eu-west-1.elb.amazonaws.com"
    }
  }

  mock_resource "aws_lb_target_group" {
    defaults = {
      arn        = "arn:aws:elasticloadbalancing:eu-west-1:111111111111:targetgroup/mock/0123456789abcdef"
      arn_suffix = "targetgroup/mock/0123456789abcdef"
    }
  }

  mock_resource "aws_kms_key" {
    defaults = {
      arn = "arn:aws:kms:eu-west-1:111111111111:key/00000000-0000-0000-0000-000000000000"
    }
  }

  mock_resource "aws_cloudwatch_log_group" {
    defaults = {
      arn = "arn:aws:logs:eu-west-1:111111111111:log-group:mock"
    }
  }

  mock_resource "aws_iam_role" {
    defaults = {
      arn = "arn:aws:iam::111111111111:role/mock"
    }
  }

  mock_resource "aws_ecs_cluster" {
    defaults = {
      arn = "arn:aws:ecs:eu-west-1:111111111111:cluster/mock"
    }
  }

  mock_resource "aws_ecs_task_definition" {
    defaults = {
      arn                  = "arn:aws:ecs:eu-west-1:111111111111:task-definition/mock:1"
      arn_without_revision = "arn:aws:ecs:eu-west-1:111111111111:task-definition/mock"
    }
  }

  mock_resource "aws_secretsmanager_secret" {
    defaults = {
      arn = "arn:aws:secretsmanager:eu-west-1:111111111111:secret:mock-AbCdEf"
    }
  }

  mock_resource "aws_ecr_repository" {
    defaults = {
      arn            = "arn:aws:ecr:eu-west-1:111111111111:repository/mock"
      repository_url = "111111111111.dkr.ecr.eu-west-1.amazonaws.com/mock"
    }
  }

  mock_resource "aws_s3_bucket" {
    defaults = {
      arn = "arn:aws:s3:::mock"
    }
  }

  mock_resource "aws_db_instance" {
    defaults = {
      address = "docqa-prod.abcdefghij.eu-west-1.rds.amazonaws.com"
      port    = 5432
      master_user_secret = [{
        kms_key_id    = "alias/mock"
        secret_arn    = "arn:aws:secretsmanager:eu-west-1:111111111111:secret:rds!db-mock-AbCdEf"
        secret_status = "active"
      }]
    }
  }
}

variables {
  app_origin      = "https://docqa.example.com"
  certificate_arn = "arn:aws:acm:eu-west-1:111111111111:certificate/00000000-0000-0000-0000-000000000000"
  image_tag       = "0123abc"
}

run "defaults_build_a_hardened_deployment" {
  command = apply

  assert {
    condition     = length(aws_subnet.public) == 2 && length(aws_subnet.private) == 2 && length(aws_nat_gateway.main) == 2
    error_message = "Two zones should give two public subnets, two private subnets and one NAT gateway each."
  }

  assert {
    condition     = length(aws_ecs_service.app) == 1 && length(aws_appautoscaling_target.app) == 1
    error_message = "The service and its autoscaling should exist by default."
  }

  assert {
    condition     = alltrue([for repository in aws_ecr_repository.this : repository.image_tag_mutability == "IMMUTABLE" && repository.image_scanning_configuration[0].scan_on_push])
    error_message = "Image repositories must be immutable and scan on push."
  }

  assert {
    condition     = aws_db_instance.main.storage_encrypted && !aws_db_instance.main.publicly_accessible && aws_db_instance.main.manage_master_user_password && aws_db_instance.main.deletion_protection
    error_message = "The database must be encrypted, private, use a managed master secret and be protected from deletion."
  }

  assert {
    condition     = aws_lb.main.idle_timeout == 120 && aws_lb_target_group.app.deregistration_delay == "120"
    error_message = "Streams need the load balancer idle timeout and the drain time to be 120 seconds."
  }

  assert {
    condition     = aws_vpc_security_group_ingress_rule.db_from_app.cidr_ipv4 == null && aws_vpc_security_group_ingress_rule.db_from_app.from_port == 5432
    error_message = "The database must only accept PostgreSQL from the task security group."
  }

  assert {
    condition     = startswith(aws_db_instance.main.final_snapshot_identifier, "docqa-prod-final-") && aws_db_instance.main.final_snapshot_identifier != "docqa-prod-final-"
    error_message = "The final snapshot name needs a stamp, or tearing the stack down a second time would collide with the first snapshot."
  }

  assert {
    condition     = alltrue([for repository in aws_ecr_lifecycle_policy.this : jsondecode(repository.policy).rules[1].selection.countNumber == 100])
    error_message = "Rollbacks need history: each repository should keep its 100 most recent images."
  }

  assert {
    condition     = length(aws_cloudwatch_log_group.insights) == 1 && aws_cloudwatch_log_group.insights[0].retention_in_days == 30 && aws_cloudwatch_log_group.insights[0].name == "/aws/ecs/containerinsights/docqa-prod/performance"
    error_message = "Container Insights should write to a log group that is made first and has a retention period."
  }

  assert {
    condition     = aws_scheduler_schedule.purge.state == "ENABLED"
    error_message = "The purge schedule should run by default."
  }
}

run "tasks_are_locked_down_and_hold_no_secret_values" {
  command = apply

  assert {
    condition = alltrue([
      for task in [aws_ecs_task_definition.app, aws_ecs_task_definition.migrate, aws_ecs_task_definition.purge] :
      jsondecode(task.container_definitions)[0].readonlyRootFilesystem == true
      && jsondecode(task.container_definitions)[0].linuxParameters.capabilities.drop == ["ALL"]
      && jsondecode(task.container_definitions)[0].linuxParameters.initProcessEnabled == true
    ])
    error_message = "Every task needs a read-only root filesystem, no capabilities and an init process."
  }

  assert {
    condition = alltrue([
      for task in [aws_ecs_task_definition.app, aws_ecs_task_definition.migrate, aws_ecs_task_definition.purge] :
      alltrue([for entry in jsondecode(task.container_definitions)[0].environment : !can(regex("PASSWORD|SECRET|API_KEY", entry.name))])
    ])
    error_message = "Secret values must come from Secrets Manager, never from plain environment entries."
  }

  assert {
    condition     = toset([for secret in jsondecode(aws_ecs_task_definition.app.container_definitions)[0].secrets : secret.name]) == toset(["JWT_SECRET", "GEMINI_API_KEY", "PGPASSWORD"])
    error_message = "The app should receive exactly the signing key, the Gemini key and its database password."
  }

  assert {
    condition     = jsondecode(aws_ecs_task_definition.app.container_definitions)[0].stopTimeout == 120
    error_message = "The app needs the full two minutes to drain streams on shutdown."
  }

  assert {
    condition = (
      jsondecode(aws_ecs_task_definition.app.container_definitions)[0].user == "1001"
      && jsondecode(aws_ecs_task_definition.migrate.container_definitions)[0].user == "1000"
      && jsondecode(aws_ecs_task_definition.purge.container_definitions)[0].user == "1000"
    )
    error_message = "Every container runs as the image's own non-root user, named in the task definition so a mistaken image cannot run as root."
  }

  assert {
    condition     = contains([for entry in jsondecode(aws_ecs_task_definition.app.container_definitions)[0].environment : "${entry.name}=${entry.value}"], "HOSTNAME=0.0.0.0")
    error_message = "The app must listen on every interface, so it must not take the container's own host name."
  }

  assert {
    condition     = contains([for entry in jsondecode(aws_ecs_task_definition.app.container_definitions)[0].environment : "${entry.name}=${entry.value}"], "QA_PROMPT_VERSION=v1")
    error_message = "The prompt version must reach the app, or rolling a prompt change back would mean editing the task definition."
  }

  assert {
    condition = alltrue([
      for task in [aws_ecs_task_definition.app, aws_ecs_task_definition.migrate, aws_ecs_task_definition.purge] :
      jsondecode(task.container_definitions)[0].logConfiguration.options.mode == "non-blocking"
    ])
    error_message = "A slow log service must never stall a task."
  }

  assert {
    condition     = length([for secret in jsondecode(aws_ecs_task_definition.migrate.container_definitions)[0].secrets : secret if endswith(secret.valueFrom, ":password::")]) == 1
    error_message = "The migration task should read only the password key of the managed master secret."
  }

  assert {
    condition     = length(aws_iam_role.execution) == 3 && alltrue([for task in [aws_ecs_task_definition.app, aws_ecs_task_definition.migrate, aws_ecs_task_definition.purge] : task.task_role_arn == null])
    error_message = "Each task gets its own execution role and none gets a task role."
  }
}

run "first_apply_creates_everything_but_the_service" {
  command = plan

  variables {
    deploy_service = false
  }

  assert {
    condition     = length(aws_ecs_service.app) == 0 && length(aws_appautoscaling_target.app) == 0 && length(aws_appautoscaling_policy.cpu) == 0
    error_message = "With deploy_service off there must be no service and no autoscaling."
  }

  assert {
    condition     = aws_db_instance.main.identifier == "docqa-prod"
    error_message = "The database and everything else is still planned."
  }

  assert {
    condition     = aws_scheduler_schedule.purge.state == "DISABLED"
    error_message = "The purge must not run before the app, its login and its data exist."
  }
}

run "three_zones_scale_the_network" {
  command = plan

  variables {
    az_count           = 3
    single_nat_gateway = true
  }

  assert {
    condition     = length(aws_subnet.private) == 3 && length(aws_nat_gateway.main) == 1 && length(aws_route_table.private) == 3
    error_message = "Three private subnets should all route through the single NAT gateway."
  }
}

run "the_migrator_tag_can_lead_the_app_tag" {
  command = plan

  variables {
    migrator_image_tag = "9999fff"
  }

  assert {
    condition     = endswith(jsondecode(aws_ecs_task_definition.migrate.container_definitions)[0].image, ":9999fff")
    error_message = "The migration task should use its own tag so it can run before the app rolls out."
  }

  assert {
    condition     = endswith(jsondecode(aws_ecs_task_definition.purge.container_definitions)[0].image, ":0123abc")
    error_message = "The purge belongs to the release that is running, so it follows the app's tag, not the migration's."
  }
}

run "the_prompt_version_can_be_rolled_back_with_one_variable" {
  command = plan

  variables {
    qa_prompt_version = "v2"
  }

  assert {
    condition     = contains([for entry in jsondecode(aws_ecs_task_definition.app.container_definitions)[0].environment : "${entry.name}=${entry.value}"], "QA_PROMPT_VERSION=v2")
    error_message = "The app should run the prompt version it was told to."
  }
}

run "container_insights_can_be_turned_off" {
  command = plan

  variables {
    container_insights = false
  }

  assert {
    condition     = length(aws_cloudwatch_log_group.insights) == 0
    error_message = "With Container Insights off there is nothing to write, so no log group."
  }
}

run "refuses_a_moving_image_tag" {
  command = plan

  variables {
    image_tag = "latest"
  }

  expect_failures = [var.image_tag]
}

run "refuses_an_http_origin" {
  command = plan

  variables {
    app_origin = "http://docqa.example.com"
  }

  expect_failures = [var.app_origin]
}

run "refuses_a_single_zone" {
  command = plan

  variables {
    az_count = 1
  }

  expect_failures = [var.az_count]
}

run "refuses_a_maximum_below_the_minimum" {
  command = plan

  variables {
    min_count = 4
    max_count = 2
  }

  expect_failures = [var.max_count]
}

run "refuses_a_size_fargate_does_not_offer" {
  command = plan

  variables {
    cpu    = 256
    memory = 4096
  }

  expect_failures = [aws_ecs_task_definition.app]
}

run "refuses_an_upper_case_name" {
  command = plan

  variables {
    name = "Docqa"
  }

  expect_failures = [var.name]
}

run "refuses_an_unknown_environment" {
  command = plan

  variables {
    environment = "qa"
  }

  expect_failures = [var.environment]
}

run "refuses_an_address_range_that_is_not_one" {
  command = plan

  variables {
    vpc_cidr = "not-a-cidr"
  }

  expect_failures = [var.vpc_cidr]
}

run "refuses_a_certificate_that_is_not_an_acm_arn" {
  command = plan

  variables {
    certificate_arn = "arn:aws:iam::111111111111:server-certificate/old"
  }

  expect_failures = [var.certificate_arn]
}

run "refuses_an_unknown_cpu_architecture" {
  command = plan

  variables {
    cpu_architecture = "RISCV64"
  }

  expect_failures = [var.cpu_architecture]
}

run "refuses_a_log_retention_cloudwatch_does_not_offer" {
  command = plan

  variables {
    log_retention_days = 10
  }

  expect_failures = [var.log_retention_days]
}

run "refuses_an_app_login_name_postgres_would_fold" {
  command = plan

  variables {
    app_db_user = "App-RW"
  }

  expect_failures = [var.app_db_user]
}

run "refuses_a_pool_of_no_connections" {
  command = plan

  variables {
    db_pool_max = 0
  }

  expect_failures = [var.db_pool_max]
}

run "refuses_a_pool_the_application_would_not_accept" {
  command = plan

  variables {
    db_pool_max = 101
  }

  expect_failures = [var.db_pool_max]
}

run "refuses_to_turn_automated_backups_off" {
  command = plan

  variables {
    db_backup_retention_days = 0
  }

  expect_failures = [var.db_backup_retention_days]
}

run "refuses_more_backup_days_than_rds_keeps" {
  command = plan

  variables {
    db_backup_retention_days = 36
  }

  expect_failures = [var.db_backup_retention_days]
}

run "refuses_an_execution_policy_with_a_wildcard_action" {
  command = plan

  override_data {
    target = data.aws_iam_policy_document.execution["purge"]
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"Everything\",\"Effect\":\"Allow\",\"Action\":\"s3:*\",\"Resource\":\"arn:aws:s3:::example\"}]}"
    }
  }

  expect_failures = [aws_iam_role_policy.execution]
}

run "refuses_an_execution_policy_that_names_every_resource_outside_ecr_login" {
  command = plan

  override_data {
    target = data.aws_iam_policy_document.execution["app"]
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"ReadSecrets\",\"Effect\":\"Allow\",\"Action\":[\"secretsmanager:GetSecretValue\"],\"Resource\":\"*\"}]}"
    }
  }

  expect_failures = [aws_iam_role_policy.execution]
}

run "refuses_a_scheduler_policy_with_a_wildcard_action" {
  command = plan

  override_data {
    target = data.aws_iam_policy_document.scheduler_run
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"ecs:*\"],\"Resource\":\"arn:aws:ecs:eu-west-1:111111111111:task-definition/x\"}]}"
    }
  }

  expect_failures = [aws_iam_role_policy.scheduler]
}

run "refuses_a_flow_log_policy_with_a_wildcard_action" {
  command = plan

  override_data {
    target = data.aws_iam_policy_document.flow_write
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"logs:*\",\"Resource\":\"arn:aws:logs:eu-west-1:111111111111:log-group:x:*\"}]}"
    }
  }

  expect_failures = [aws_iam_role_policy.flow]
}

run "lets_ecr_login_name_every_resource_and_ignores_what_a_policy_denies" {
  command = plan

  override_data {
    target = data.aws_iam_policy_document.execution["app"]
    values = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Sid\":\"EcrLogin\",\"Effect\":\"Allow\",\"Action\":\"ecr:GetAuthorizationToken\",\"Resource\":\"*\"},{\"Sid\":\"NoBuckets\",\"Effect\":\"Deny\",\"Action\":\"s3:*\",\"Resource\":\"*\"}]}"
    }
  }

  assert {
    condition     = length(aws_ecs_task_definition.app.family) > 0
    error_message = "A policy whose only broad statements are the ECR login and a deny should pass the guard."
  }
}

run "refuses_a_prompt_version_that_is_not_a_version" {
  command = plan

  variables {
    qa_prompt_version = "latest"
  }

  expect_failures = [var.qa_prompt_version]
}
