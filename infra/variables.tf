variable "region" {
  type    = string
  default = "us-east-1"
}

variable "google_client_id" {
  type        = string
  description = "Google OAuth client ID (public value) used as the ID-token audience."
}

variable "allowed_origins" {
  type        = list(string)
  description = "Browser origins allowed by CORS (the GitHub Pages origin, no trailing slash or path)."
  default     = ["https://biplavkharel.github.io"]
}

variable "image_tag" {
  type    = string
  default = "latest"
}

variable "desired_count" {
  type    = number
  default = 1
}

variable "github_repo" {
  type        = string
  description = "owner/repo allowed to deploy via GitHub OIDC."
  default     = "BiplavKharel/crossword"
}

variable "create_github_oidc_provider" {
  type        = bool
  description = "Set false if the account already has the token.actions.githubusercontent.com OIDC provider."
  default     = true
}
