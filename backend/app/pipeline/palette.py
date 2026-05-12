from pathlib import Path

import numpy as np
from PIL import Image
from sklearn.cluster import KMeans

_N_CLUSTERS = 5
_SAMPLE_SIZE = 100


def extract_palette_hex(frame_path: Path) -> list[str]:
    """Return 5 dominant colors of a frame as hex strings, ordered by cluster size desc."""
    img = Image.open(frame_path).convert("RGB")
    img.thumbnail((_SAMPLE_SIZE, _SAMPLE_SIZE))
    pixels = np.array(img).reshape(-1, 3)
    km = KMeans(n_clusters=_N_CLUSTERS, n_init=4, random_state=42).fit(pixels)
    centers = km.cluster_centers_.astype(int)
    counts = np.bincount(km.labels_, minlength=_N_CLUSTERS)
    order = np.argsort(-counts)
    return [_rgb_to_hex(centers[i]) for i in order]


def _rgb_to_hex(rgb) -> str:
    return "#" + "".join(f"{c:02x}" for c in rgb)
