locals {
  prefix       = "${var.name}-${var.environment}"
  account_id   = data.aws_caller_identity.current.account_id
  partition    = data.aws_partition.current.partition
  azs          = slice(data.aws_availability_zones.available.names, 0, var.az_count)
  nat_count    = var.single_nat_gateway ? 1 : var.az_count
  migrator_tag = var.migrator_image_tag != "" ? var.migrator_image_tag : var.image_tag
}
