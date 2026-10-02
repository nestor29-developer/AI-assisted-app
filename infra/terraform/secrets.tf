# Containers only: values are set with `aws secretsmanager put-secret-value`, so they never reach code or state.
locals {
  secret_recovery_days = var.deletion_protection ? 30 : 0
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "${local.prefix}/jwt-secret"
  description             = "Signing key for session cookies: at least 43 random characters (openssl rand -base64 48)."
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = local.secret_recovery_days
}

resource "aws_secretsmanager_secret" "gemini" {
  name                    = "${local.prefix}/gemini-api-key"
  description             = "Gemini API key. A paid-tier key keeps prompts out of model training."
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = local.secret_recovery_days
}

resource "aws_secretsmanager_secret" "app_db" {
  name                    = "${local.prefix}/app-db-password"
  description             = "Password of the least-privilege database login (at least 16 characters). The migration task creates the login from it."
  kms_key_id              = aws_kms_key.main.arn
  recovery_window_in_days = local.secret_recovery_days
}
