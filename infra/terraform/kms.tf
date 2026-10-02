resource "aws_kms_key" "main" {
  description             = "${local.prefix}: database storage, Performance Insights and application secrets"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.prefix}"
  target_key_id = aws_kms_key.main.key_id
}
