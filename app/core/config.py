from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field


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

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
