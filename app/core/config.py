from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import EmailStr, Field, SecretStr, model_validator


class Settings(BaseSettings):
    database_url: str
    redis_url: str
    upload_dir: str = "uploads"
    secret_key: str
    anthropic_api_key: str
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    categorization_model: str = "claude-haiku-4-5-20251001"
    categorization_confidence_threshold: float = Field(default=0.85, ge=0, le=1)
    categorization_max_tries: int = Field(default=3, ge=1, le=10)
    financial_qa_model: str = "claude-haiku-4-5-20251001"
    financial_qa_max_queries_per_minute: int = Field(default=10, ge=1, le=100)
    anomaly_max_explanations_per_minute: int = Field(default=10, ge=1, le=100)
    anomaly_explanation_model: str = "claude-haiku-4-5-20251001"
    weekly_digest_model: str = "claude-haiku-4-5-20251001"
    digest_smtp_host: str | None = None
    digest_smtp_port: int = Field(default=587, ge=1, le=65535)
    digest_smtp_username: str | None = None
    digest_smtp_password: SecretStr | None = None
    digest_smtp_starttls: bool = True
    digest_email_from: EmailStr | None = None
    supabase_url: str | None = None
    supabase_jwt_secret: SecretStr | None = None
    app_public_url: str = "http://127.0.0.1:5173"
    smtp_host: str | None = None
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_user: str | None = None
    smtp_password: SecretStr | None = None
    smtp_from: EmailStr | None = None

    @model_validator(mode="after")
    def smtp_credentials_must_be_paired(self) -> "Settings":
        if bool(self.digest_smtp_username) != bool(self.digest_smtp_password):
            raise ValueError(
                "DIGEST_SMTP_USERNAME and DIGEST_SMTP_PASSWORD must be configured together"
            )
        if bool(self.smtp_user) != bool(self.smtp_password):
            raise ValueError("SMTP_USER and SMTP_PASSWORD must be configured together")
        return self

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
