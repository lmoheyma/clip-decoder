from __future__ import annotations
import json
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any
from sqlalchemy import String, Float, Integer, DateTime, JSON, ForeignKey, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.models import Report


class AnalysisStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    ERROR = "error"


class Base(DeclarativeBase):
    pass


class AnalysisRow(Base):
    __tablename__ = "analyses"

    youtube_id: Mapped[str] = mapped_column(String, primary_key=True)
    status: Mapped[str] = mapped_column(String, nullable=False)
    title: Mapped[str] = mapped_column(String, default="")
    channel: Mapped[str] = mapped_column(String, default="")
    duration_s: Mapped[float] = mapped_column(Float, default=0.0)
    report_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    error: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class FlagRow(Base):
    __tablename__ = "flagged_references"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    youtube_id: Mapped[str] = mapped_column(
        String, ForeignKey("analyses.youtube_id"), nullable=False
    )
    ref_index: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )


class Database:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._engine = create_async_engine(
            f"sqlite+aiosqlite:///{db_path}", future=True
        )
        self._session = async_sessionmaker(self._engine, expire_on_commit=False)

    async def init(self) -> None:
        async with self._engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    async def set_status(
        self, youtube_id: str, status: AnalysisStatus, error: str | None = None
    ) -> None:
        async with self._session() as s:
            row = await s.get(AnalysisRow, youtube_id)
            if row is None:
                row = AnalysisRow(youtube_id=youtube_id, status=status.value, error=error)
                s.add(row)
            else:
                row.status = status.value
                row.error = error
            await s.commit()

    async def get_status(self, youtube_id: str) -> AnalysisStatus | None:
        async with self._session() as s:
            row = await s.get(AnalysisRow, youtube_id)
            return AnalysisStatus(row.status) if row else None

    async def save_report(self, report: Report, status: AnalysisStatus) -> None:
        async with self._session() as s:
            row = await s.get(AnalysisRow, report.youtube_id)
            payload = json.loads(report.model_dump_json())
            if row is None:
                row = AnalysisRow(
                    youtube_id=report.youtube_id,
                    status=status.value,
                    title=report.title,
                    channel=report.channel,
                    duration_s=report.duration_s,
                    report_json=payload,
                )
                s.add(row)
            else:
                row.status = status.value
                row.title = report.title
                row.channel = report.channel
                row.duration_s = report.duration_s
                row.report_json = payload
            await s.commit()

    async def load_report(self, youtube_id: str) -> Report | None:
        """Return the cached Report or None if not yet completed.

        Returns None for both 'no row exists' and 'row exists but
        analysis is still RUNNING/PENDING/ERROR'. Callers that need
        to distinguish these cases must call get_status first.
        """
        async with self._session() as s:
            row = await s.get(AnalysisRow, youtube_id)
            if row is None or row.report_json is None:
                return None
            return Report.model_validate(row.report_json)

    async def flag_reference(
        self, youtube_id: str, ref_index: int, reason: str | None = None
    ) -> None:
        async with self._session() as s:
            s.add(FlagRow(youtube_id=youtube_id, ref_index=ref_index, reason=reason))
            await s.commit()

    async def list_flags(self, youtube_id: str) -> list[dict[str, Any]]:
        async with self._session() as s:
            stmt = select(FlagRow).where(FlagRow.youtube_id == youtube_id)
            result = await s.execute(stmt)
            return [
                {
                    "ref_index": r.ref_index,
                    "reason": r.reason,
                    "created_at": r.created_at.isoformat(),
                }
                for r in result.scalars().all()
            ]
