variable "name" {
  description = "Prefix for every resource name."
  type        = string
  default     = "docqa"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,15}$", var.name))
    error_message = "Use 2 to 16 lower-case letters, digits or hyphens, starting with a letter (load balancer and target group names are capped at 32 characters)."
  }
}

variable "environment" {
  description = "Which deployment this is; part of every name, so environments can share an account."
  type        = string
  default     = "prod"

  validation {
    condition     = contains(["dev", "staging", "prod"], var.environment)
    error_message = "Use dev, staging or prod."
  }
}

variable "region" {
  description = "AWS region."
  type        = string
  default     = "eu-west-1"
}

variable "vpc_cidr" {
  description = "Address range of the VPC; it is split into public and private subnets per zone."
  type        = string
  default     = "10.20.0.0/16"

  validation {
    condition     = can(cidrhost(var.vpc_cidr, 0))
    error_message = "Use a valid CIDR block such as 10.20.0.0/16."
  }
}

variable "az_count" {
  description = "Availability zones to spread across (the load balancer needs at least two)."
  type        = number
  default     = 2

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "Use 2 or 3 zones."
  }
}

variable "single_nat_gateway" {
  description = "One NAT gateway for all zones instead of one per zone: cheaper, but one zone's outage cuts the others' internet access."
  type        = bool
  default     = false
}

variable "app_origin" {
  description = "The https origin people open, for example https://docqa.example.com. It must match the certificate."
  type        = string

  validation {
    condition     = can(regex("^https://[^/]+$", var.app_origin))
    error_message = "Use an https origin without a path, such as https://docqa.example.com."
  }
}

variable "certificate_arn" {
  description = "ACM certificate for the load balancer's HTTPS listener (in the same region)."
  type        = string

  validation {
    condition     = can(regex("^arn:aws[a-z-]*:acm:", var.certificate_arn))
    error_message = "Use the ARN of an ACM certificate."
  }
}

variable "image_tag" {
  description = "Tag of the app image in ECR, normally a git SHA."
  type        = string

  validation {
    condition     = var.image_tag != "latest" && var.image_tag != ""
    error_message = "Use an explicit tag. Repositories are immutable and a moving tag hides what is running."
  }
}

variable "migrator_image_tag" {
  description = "Tag of the migration image; empty means the same as image_tag."
  type        = string
  default     = ""
}

variable "cpu_architecture" {
  description = "Must match how the images were built."
  type        = string
  default     = "X86_64"

  validation {
    condition     = contains(["X86_64", "ARM64"], var.cpu_architecture)
    error_message = "Use X86_64 or ARM64."
  }
}

variable "cpu" {
  description = "Fargate CPU units per app task."
  type        = number
  default     = 512
}

variable "memory" {
  description = "Memory in MiB per app task (parsing a large PDF needs headroom)."
  type        = number
  default     = 1024
}

variable "deploy_service" {
  description = "Create the app service and its autoscaling. Leave false on the first apply, then push images, set secret values and run the migration before turning it on."
  type        = bool
  default     = true
}

variable "desired_count" {
  description = "Initial number of app tasks; autoscaling takes over afterwards."
  type        = number
  default     = 2
}

variable "min_count" {
  description = "Fewest app tasks autoscaling may keep (two means one can fail or deploy without an outage)."
  type        = number
  default     = 2
}

variable "max_count" {
  description = "Most app tasks autoscaling may start. Each one holds up to db_pool_max database connections."
  type        = number
  default     = 10

  validation {
    condition     = var.max_count >= var.min_count
    error_message = "max_count must not be lower than min_count."
  }
}

variable "db_pool_max" {
  description = "Connections one app task may open. max_count x 2 (rolling deploys) x this must stay well under the database's max_connections."
  type        = number
  default     = 5

  validation {
    condition     = var.db_pool_max >= 1 && var.db_pool_max <= 100
    error_message = "Use 1 to 100 connections per task (the application accepts no more than 100)."
  }
}

variable "container_insights" {
  description = "Per-task CPU, memory and network metrics in CloudWatch (a few dollars a month at this size)."
  type        = bool
  default     = true
}

variable "db_instance_class" {
  description = "RDS instance class. Performance Insights is on, which needs db.t4g.medium or larger."
  type        = string
  default     = "db.t4g.medium"
}

variable "db_allocated_storage" {
  description = "Initial storage in GiB."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Storage autoscaling ceiling in GiB."
  type        = number
  default     = 100
}

variable "db_multi_az" {
  description = "Keep a standby in a second zone."
  type        = bool
  default     = true
}

variable "db_backup_retention_days" {
  description = "How long automated backups are kept; they are what point-in-time restore is made from."
  type        = number
  default     = 7

  validation {
    condition     = var.db_backup_retention_days >= 1 && var.db_backup_retention_days <= 35
    error_message = "Use 1 to 35 days: 0 would turn automated backups off, and RDS keeps at most 35."
  }
}

variable "deletion_protection" {
  description = "Refuse to delete the database and the load balancer; turn off deliberately to tear down."
  type        = bool
  default     = true
}

variable "log_retention_days" {
  description = "How long CloudWatch keeps logs; the application never logs prompts or document text."
  type        = number
  default     = 30

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "CloudWatch only accepts specific retention periods."
  }
}

variable "llm_model" {
  description = "Gemini model the app calls."
  type        = string
  default     = "gemini-3.8-flash"
}

variable "daily_token_budget" {
  description = "Tokens one user may spend in 24 hours."
  type        = number
  default     = 200000
}

variable "data_retention_days" {
  description = "Days an uploaded document and its conversation are kept."
  type        = number
  default     = 30
}

variable "ai_request_retention_days" {
  description = "Days the audit rows of AI calls (tokens, cost, retrieval trace; never text) are kept."
  type        = number
  default     = 90
}

variable "purge_schedule" {
  description = "When the retention purge runs, as an EventBridge Scheduler expression (UTC). The default is after the database's weekly maintenance window."
  type        = string
  default     = "cron(30 4 * * ? *)"
}

variable "app_db_user" {
  description = "Name of the least-privilege database login the app runs as."
  type        = string
  default     = "app_rw"

  validation {
    condition     = can(regex("^[a-z_][a-z0-9_]{0,62}$", var.app_db_user))
    error_message = "Use a lower-case Postgres role name."
  }
}
