locals {
  # One execution role per task, each limited to the image and secrets that task needs.
  tasks = {
    app = {
      repository = "app"
      secrets = [
        aws_secretsmanager_secret.jwt.arn,
        aws_secretsmanager_secret.gemini.arn,
        aws_secretsmanager_secret.app_db.arn,
      ]
    }
    migrate = {
      repository = "migrator"
      secrets = [
        aws_db_instance.main.master_user_secret[0].secret_arn,
        aws_secretsmanager_secret.app_db.arn,
      ]
    }
    purge = {
      repository = "migrator"
      secrets    = [aws_secretsmanager_secret.app_db.arn]
    }
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
      values   = ["arn:aws:ecs:${var.region}:${local.account_id}:*"]
    }
  }
}

data "aws_iam_policy_document" "execution" {
  for_each = local.tasks

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
    resources = [aws_ecr_repository.this[each.value.repository].arn]
  }

  statement {
    sid       = "WriteOwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.task[each.key].arn}:*"]
  }

  statement {
    sid       = "ReadOwnSecrets"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = each.value.secrets
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
  for_each = local.tasks

  name               = "${local.prefix}-${each.key}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy" "execution" {
  for_each = local.tasks

  name   = "execution"
  role   = aws_iam_role.execution[each.key].id
  policy = data.aws_iam_policy_document.execution[each.key].json
}

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
}
