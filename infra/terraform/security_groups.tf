resource "aws_security_group" "alb" {
  name_prefix = "${local.prefix}-alb-"
  description = "Load balancer: HTTPS from the internet, HTTP only to redirect"
  vpc_id      = aws_vpc.main.id

  lifecycle {
    create_before_destroy = true
  }
}

# The app, migration and purge tasks share one group: only the app listens on a port.
resource "aws_security_group" "app" {
  name_prefix = "${local.prefix}-app-"
  description = "App, migration and purge tasks"
  vpc_id      = aws_vpc.main.id

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_security_group" "db" {
  name_prefix = "${local.prefix}-db-"
  description = "Database: PostgreSQL from the tasks only"
  vpc_id      = aws_vpc.main.id

  lifecycle {
    create_before_destroy = true
  }
}

# Rules are separate resources so the groups can reference each other without a cycle.
resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTPS from the internet"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_ingress_rule" "alb_http" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP, answered with a redirect to HTTPS"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
}

resource "aws_vpc_security_group_egress_rule" "alb_to_app" {
  security_group_id            = aws_security_group.alb.id
  description                  = "Forward to the app tasks"
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

resource "aws_vpc_security_group_ingress_rule" "app_from_alb" {
  security_group_id            = aws_security_group.app.id
  description                  = "Traffic from the load balancer"
  referenced_security_group_id = aws_security_group.alb.id
  ip_protocol                  = "tcp"
  from_port                    = 3000
  to_port                      = 3000
}

# Gemini is a public API, so egress cannot be pinned to addresses; an FQDN allow-list needs a firewall.
#trivy:ignore:AVD-AWS-0104
resource "aws_vpc_security_group_egress_rule" "app_https" {
  security_group_id = aws_security_group.app.id
  description       = "HTTPS out: Gemini API, ECR, Secrets Manager and CloudWatch, through the NAT gateway"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "app_to_db" {
  security_group_id            = aws_security_group.app.id
  description                  = "PostgreSQL"
  referenced_security_group_id = aws_security_group.db.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

# The database group has no egress rules: replies to allowed connections need none.
resource "aws_vpc_security_group_ingress_rule" "db_from_app" {
  security_group_id            = aws_security_group.db.id
  description                  = "PostgreSQL from the tasks"
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}
