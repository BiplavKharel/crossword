resource "aws_ecr_repository" "server" {
  name                 = "${local.name}-server"
  image_tag_mutability = "MUTABLE"
  force_delete         = true
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_lifecycle_policy" "server" {
  repository = aws_ecr_repository.server.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 10 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 10 }
      action       = { type = "expire" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "server" {
  name              = "/ecs/${local.name}-server"
  retention_in_days = 30
}

resource "aws_ecs_cluster" "main" {
  name = local.name
}

data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "${local.name}-task-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_ecs_task_definition" "server" {
  family                   = "${local.name}-server"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.task_execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([{
    name         = "server"
    image        = "${aws_ecr_repository.server.repository_url}:${var.image_tag}"
    essential    = true
    portMappings = [{ containerPort = local.container_port, protocol = "tcp" }]
    environment = [
      { name = "PORT", value = tostring(local.container_port) },
      { name = "GOOGLE_CLIENT_ID", value = var.google_client_id },
      { name = "ALLOWED_ORIGINS", value = join(",", var.allowed_origins) },
      { name = "DDB_TABLE", value = aws_dynamodb_table.main.name },
      { name = "AWS_REGION", value = var.region },
      # ALLOW_GUEST must never be set in production.
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.server.name
        awslogs-region        = var.region
        awslogs-stream-prefix = "server"
      }
    }
  }])
}

resource "aws_ecs_service" "server" {
  name            = "${local.name}-server"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.server.arn
  desired_count   = var.desired_count
  launch_type     = "FARGATE"

  health_check_grace_period_seconds = 30

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.server.arn
    container_name   = "server"
    container_port   = local.container_port
  }

  depends_on = [aws_lb_listener_rule.from_cloudfront]
}
