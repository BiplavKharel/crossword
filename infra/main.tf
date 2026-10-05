terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
  # Local state to start. Move to an S3 backend when more than one person applies.
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "crossword" }
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_caller_identity" "current" {}

locals {
  name           = "crossword"
  container_port = 8787
  azs            = slice(data.aws_availability_zones.available.names, 0, 2)
}
