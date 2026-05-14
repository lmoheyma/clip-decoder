"""Seed a fixture Report into the dev DB so /report/{id} renders without
running the full pipeline. Run inside the backend container:
  docker exec clip-decoder-backend-1 python -m scripts.seed_fixture
"""
from __future__ import annotations
import asyncio
from app.db import AnalysisStatus, Database
from app.models import (
    Confidence,
    FrameAnalysis,
    Report,
    Verdict,
    VerifiedReference,
)
from app.settings import settings


YID = "BtyHYIpykN0"


def make_frame(i: int, comp: str, palette: list[str], hex_: list[str]) -> FrameAnalysis:
    return FrameAnalysis(
        timestamp_s=float(i * 8),
        frame_id=f"shot_{i:02d}",
        composition=comp,
        palette=palette,
        palette_hex=hex_,
        camera_move="locked off; slight push-in",
        costume_setting="contemporary",
        distinctive_features=["high contrast", "symmetrical staging"],
        raw_description=comp,
        confidence_in_observation=0.82,
    )


def make_ref(
    i: int,
    title: str,
    creator: str,
    year: int,
    work_type: str,
    conf: Confidence,
    cross: str,
    adv: str,
    wiki: str,
    medium: str | None = None,
    institution: str | None = None,
    inception: int | None = None,
    wiki_url: str | None = None,
) -> VerifiedReference:
    return VerifiedReference(
        timestamp_s=float(i * 8),
        source_frame_id=f"shot_{i:02d}",
        work_title=title,
        work_creator=creator,
        work_year=year,
        work_type=work_type,
        raw_confidence=0.75 if conf is Confidence.CONFIRMED else 0.55,
        verdict=Verdict.KEEP if conf is Confidence.CONFIRMED else Verdict.SPECULATIVE,
        final_confidence=conf,
        supporting_elements=["framing", "color palette", "subject pose"],
        wikipedia_url=wiki_url,
        wikipedia_thumbnail_url=None,
        cross_ref_reasoning=cross,
        adversarial_reasoning=adv,
        wikipedia_reasoning=wiki,
        medium=medium,
        institution=institution,
        inception_year=inception,
    )


REFS = [
    make_ref(
        0, "The Calling of Saint Matthew", "Caravaggio", 1600, "painting",
        Confidence.CONFIRMED,
        "Tenebrist lighting, diagonal hand gesture, and the pointing index finger match the canonical composition.",
        "Could be coincidental Baroque-influenced lighting, but the gesture-toward-disciple is too specific.",
        "Wikipedia summary confirms the painting's hand-of-God motif used by the director here.",
        medium="oil on canvas", institution="Contarelli Chapel, San Luigi dei Francesi",
        inception=1600, wiki_url="https://en.wikipedia.org/wiki/The_Calling_of_Saint_Matthew_(Caravaggio)",
    ),
    make_ref(
        1, "Meshes of the Afternoon", "Maya Deren", 1943, "film",
        Confidence.CONFIRMED,
        "Stair geometry, repeated through-window framing, and the hand-on-glass motif are direct lifts.",
        "Domestic interior shots are common; the specific reach-through composition is not.",
        "Wikipedia plot summary confirms the recurring window/glass motif central to the film.",
        medium="16mm film", inception=1943,
        wiki_url="https://en.wikipedia.org/wiki/Meshes_of_the_Afternoon",
    ),
    make_ref(
        2, "Le faux miroir", "René Magritte", 1929, "painting",
        Confidence.SPECULATIVE,
        "Single-eye macro framing with sky in the iris recalls Magritte's surrealist motif.",
        "Sky-reflecting eye is a common contemporary motif; weaker uniqueness.",
        "Wikipedia confirms Magritte's iconography; visual match is suggestive not definitive.",
        medium="oil on canvas", institution="Museum of Modern Art, New York",
        inception=1929, wiki_url="https://en.wikipedia.org/wiki/The_False_Mirror",
    ),
    make_ref(
        3, "Stalker", "Andrei Tarkovsky", 1979, "film",
        Confidence.SPECULATIVE,
        "Long lateral tracking shot through overgrown industrial ruins reads as Tarkovsky pastiche.",
        "Many post-Soviet videos draw from this source; matches may be aesthetic homage rather than direct quotation.",
        "Wikipedia confirms the Zone sequences this shot evokes; exact composition diverges.",
        medium="35mm film", inception=1979,
        wiki_url="https://en.wikipedia.org/wiki/Stalker_(1979_film)",
    ),
    make_ref(
        4, "Untitled Film Still #6", "Cindy Sherman", 1977, "photograph",
        Confidence.CONFIRMED,
        "Subject's recumbent pose, oversized prop, and high-key lighting echo Sherman's noir restaging.",
        "Could plausibly be a generic 50s pin-up; the prop scale tips the balance.",
        "Wikipedia summary confirms Sherman's source material and the specific still referenced.",
        medium="gelatin silver print", institution="MoMA",
        inception=1977, wiki_url="https://en.wikipedia.org/wiki/Cindy_Sherman",
    ),
    make_ref(
        5, "Sunday Afternoon on the Island of La Grande Jatte", "Georges Seurat", 1886, "painting",
        Confidence.CONFIRMED,
        "Pointillist crowd composition with parasol silhouette in mid-distance, and water-line at lower third.",
        "Park-with-parasols is a generic composition; the silhouette stack is distinctive.",
        "Wikipedia confirms Seurat's exact pose-and-shadow arrangement evoked in the frame.",
        medium="oil on canvas", institution="Art Institute of Chicago",
        inception=1886, wiki_url="https://en.wikipedia.org/wiki/A_Sunday_Afternoon_on_the_Island_of_La_Grande_Jatte",
    ),
]


FRAMES = [
    make_frame(0, "Backlit subject extending arm; tenebrist single-source light from upper-left.",
               ["amber", "deep brown", "off-white"], ["#caa067", "#3a2517", "#e8e2d4"]),
    make_frame(1, "Subject reaches through window glass; reflection doubles the figure.",
               ["pale blue", "warm grey", "milk"], ["#c8d4e0", "#8a8275", "#efebe2"]),
    make_frame(2, "Extreme close-up of one eye; sky and clouds reflected in the iris.",
               ["sky blue", "ivory", "rust"], ["#a8c8e8", "#f0e9da", "#b85c2f"]),
    make_frame(3, "Wide tracking shot along overgrown industrial corridor; tall grass in foreground.",
               ["moss green", "pewter", "yellow"], ["#7a8f57", "#9aa39e", "#d9c060"]),
    make_frame(4, "Reclining figure with oversized prop; harsh top light, deep shadows.",
               ["bone white", "graphite", "wine"], ["#ece5d2", "#2b2826", "#732a32"]),
    make_frame(5, "Crowd in profile beneath parasols; water-line at lower third, soft-focus background.",
               ["mint", "rose", "deep ocean"], ["#a7e5d3", "#e8b8c4", "#1c3a5e"]),
]


async def main() -> None:
    db = Database(db_path=settings.data_dir / "clipdecoder.sqlite")
    await db.init()
    report = Report(
        youtube_id=YID,
        title="Look at the way the colour leans in",
        channel="Field Notes / Vol. III",
        duration_s=247.0,
        references=REFS,
        frame_analyses=FRAMES,
    )
    await db.save_report(report, status=AnalysisStatus.DONE)
    print(f"Seeded fixture report at /report/{YID}")


if __name__ == "__main__":
    asyncio.run(main())
