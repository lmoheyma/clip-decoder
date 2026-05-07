from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    nvapi_key: str = ""
    nim_base_url: str = "https://integrate.api.nvidia.com/v1"
    cosmos_reason_model: str = "nvidia/cosmos-reason1-7b"
    llm_model: str = "meta/llama-3.3-70b-instruct"

    frames_per_shot: int = 1
    max_shots_per_video: int = 80
    nim_concurrency: int = 4
    wikipedia_verification: bool = True

    data_dir: Path = Path("data")
    db_path: Path = Path("data/clipdecoder.sqlite")


settings = Settings()
