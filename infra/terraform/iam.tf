locals {
  # One execution role per task: its image comes from this repository, and it may read only its own secrets.
  task_repository = {
    app     = "app"
    migrate = "migrator"
    purge   = "migrator"
  }

  task_secrets = {
    app = [
      aws_secretsmanager_secret.jwt.arn,
      aws_secretsmanager_secret.gemini.arn,
      aws_secretsmanager_secret.app_db.arn,
    ]
    migrate = [
      aws_db_instance.main.master_user_secret[0].secret_arn,
      aws_secretsmanager_secret.app_db.arn,
    ]
    purge = [aws_secretsmanager_secret.app_db.arn]
  }

  policy_documents = merge(
    { for task, document in data.aws_iam_policy_document.execution : "execution-${task}" => document.json },
    {
      scheduler = data.aws_iam_policy_document.scheduler_run.json
      flow      = data.aws_iam_policy_document.flow_write.json
    },
  )

  # No role policy may grow a wildcard action or name every resource (ECR login has no resource-level form).
  policy_findings = {
    for key, json in local.policy_documents : key => flatten([
      for statement in jsondecode(json).Statement : [
        for finding in concat(
          [for action in tolist(try(tolist(statement.Action), [statement.Action])) : "${try(statement.Sid, "a statement")} allows ${action}" if endswith(action, "*")],
          [for resource in tolist(try(tolist(statement.Resource), [statement.Resource])) : "${try(statement.Sid, "a statement")} applies to every resource" if resource == "*" && try(statement.Sid, "") != "EcrLogin"],
        ) : finding
      ] if try(statement.Effect, "Allow") == "Allow"
    ])
  }
}

# The tasks call no AWS API themselves, so none of them gets a task role.
data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:SourceArn"
      values   = ["arn:${local.partition}:ecs:${var.region}:${local.account_id}:*"]
    }
  }
}

data "aws_iam_policy_document" "execution" {
  for_each = local.task_repository

  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "PullOwnImage"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:GetDownloadUrlForLayer",
    ]
    resources = [aws_ecr_repository.this[each.value].arn]
  }

  statement {
    sid       = "WriteOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.task[each.key].arn}:*"]
  }

  statement {
    sid       = "ReadOwnSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = local.task_secrets[each.key]
  }

  statement {
    sid       = "DecryptSecrets"
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.main.arn]

    condition {
      test     = "StringEquals"
      variable = "kms:ViaService"
      values   = ["secretsmanager.${var.region}.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  for_each = local.task_repository

  name               = "${local.prefix}-${each.key}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "execution" {
  for_each = local.task_repository

  name   = "execution"
  role   = aws_iam_role.execution[each.key].id
  policy = data.aws_iam_policy_document.execution[each.key].json

  lifecycle {
    precondition {
      condition     = length(local.policy_findings["execution-${each.key}"]) == 0
      error_message = "The ${each.key} execution policy is too broad: ${join("; ", local.policy_findings["execution-${each.key}"])}."
    }
  }
}

# Only this schedule, in this account, may ask the scheduler to assume the role.
data "aws_iam_policy_document" "scheduler_assume" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["scheduler.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [local.account_id]
    }

    condition {
      test     = "ArnEquals"
      variable = "aws:SourceArn"
      values   = ["arn:${local.partition}:scheduler:${var.region}:${local.account_id}:schedule-group/default"]
    }
  }
}

data "aws_iam_policy_document" "scheduler_run" {
  statement {
    sid     = "RunPurgeTask"
    actions = ["ecs:RunTask"]
    resources = [
      aws_ecs_task_definition.purge.arn_without_revision,
      "${aws_ecs_task_definition.purge.arn_without_revision}:*",
    ]

    condition {
      test     = "ArnEquals"
      variable = "ecs:cluster"
      values   = [aws_ecs_cluster.main.arn]
    }
  }

  statement {
    sid       = "PassExecutionRole"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.execution["purge"].arn]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "scheduler" {
  name               = "${local.prefix}-scheduler"
  assume_role_policy = data.aws_iam_policy_document.scheduler_assume.json
}

resource "aws_iam_role_policy" "scheduler" {
  name   = "run-purge-task"
  role   = aws_iam_role.scheduler.id
  policy = data.aws_iam_policy_document.scheduler_run.json

  lifecycle {
    precondition {
      condition     = length(local.policy_findings["scheduler"]) == 0
      error_message = "The scheduler policy is too broad: ${join("; ", local.policy_findings["scheduler"])}."
    }
  }
}
