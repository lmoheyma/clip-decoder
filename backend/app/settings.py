from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

_ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    nvapi_key: str = ""
    nim_base_url: str = "https://integrate.api.nvidia.com/v1"
    cosmos_reason_model: str = "nvidia/nemotron-nano-12b-v2-vl"
    llm_model: str = "meta/llama-3.3-70b-instruct"

    frames_per_shot: int = 1
    max_shots_per_video: int = 80
    nim_concurrency: int = 4
    wikipedia_verification: bool = True
    # Wikidata enrichment for VerifiedReference (medium/institution/inception_year).
    # Independent of wikipedia_verification: a run can have Wikipedia URL/thumb
    # lookup enabled while skipping Wikidata calls. Wikidata is only consulted
    # when the verifier has already produced a wikipedia_url.
    wikidata_enrichment: bool = True
    wikidata_concurrency: int = 4
    wikidata_timeout_s: float = 10.0

    data_dir: Path = Path("data")
    db_path: Path = Path("data/clipdecoder.sqlite")


settings = Settings()
