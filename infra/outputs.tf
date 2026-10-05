output "api_url" {
  description = "Set this as the VITE_API_URL repo variable."
  value       = "https://${aws_cloudfront_distribution.api.domain_name}"
}

output "ecr_repository_url" {
  value = aws_ecr_repository.server.repository_url
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service" {
  value = aws_ecs_service.server.name
}

output "github_deploy_role_arn" {
  description = "Set this as the AWS_DEPLOY_ROLE_ARN repo variable."
  value       = aws_iam_role.github_deploy.arn
}

output "dynamodb_table" {
  value = aws_dynamodb_table.main.name
}
