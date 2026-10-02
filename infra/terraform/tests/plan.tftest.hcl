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
