"""
confidence.py — Unified confidence scoring engine

Used by BOTH the Slack bot and web UI to score every generated answer.

Score = semantic_score * 0.50
      + source_quality  * 0.20
      + recency_score   * 0.20
      + corroboration   * 0.10

Returns a float 0.0–1.0 and a human-readable breakdown.
"""

from datetime import datetime, timezone
from typing import Optional
import math


# ── Weights (must sum to 1.0) ────────────────────────────────

WEIGHTS = {
    "semantic":      0.50,
    "source_quality": 0.20,
    "recency":       0.20,
    "corroboration": 0.10,
}


# ── Source quality tiers ─────────────────────────────────────
# Higher = better quality source type

SOURCE_QUALITY = {
    "pdf":          0.90,
    "docx":         0.85,
    "xlsx":         0.80,
    "csv":          0.70,
    "txt":          0.60,
    "gdoc":         0.75,
    "gsheet":       0.70,
    "golden_answer": 1.00,   # Human-verified corrections always score highest
    "feedback":      0.95,
}

def _source_quality_score(sources: list[str], source_types: list[str] = None) -> float:
    """Average quality score of all source files."""
    if not sources:
        return 0.3
    scores = []
    for i, s in enumerate(sources):
        # Check source_type first (golden_answer gets 1.0)
        if source_types and i < len(source_types):
            st = source_types[i].lower()
            if st in SOURCE_QUALITY:
                scores.append(SOURCE_QUALITY[st])
                continue
        # Check for [Correction] prefix in filename
        if s.startswith("[Correction]"):
            scores.append(1.0)
            continue
        ext = s.rsplit(".", 1)[-1].lower() if "." in s else "txt"
        scores.append(SOURCE_QUALITY.get(ext, 0.65))
    return sum(scores) / len(scores)


# ── Recency score ─────────────────────────────────────────────

def _recency_score(upload_dates: list[Optional[datetime]]) -> float:
    """
    Score based on how recent the source documents are.
    Documents uploaded in the last 30 days score ~1.0.
    Documents older than 1 year score ~0.3.
    """
    if not upload_dates or all(d is None for d in upload_dates):
        return 0.5  # Unknown age → neutral

    now = datetime.now(timezone.utc)
    scores = []

    for d in upload_dates:
        if d is None:
            scores.append(0.5)
            continue
        # Handle string dates coming from Qdrant payload
        if isinstance(d, str):
            try:
                d = datetime.fromisoformat(d.replace("Z", "+00:00"))
            except Exception:
                scores.append(0.5)
                continue
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        age_days = (now - d).days
        # Exponential decay: 30 days → 1.0, 365 days → ~0.4, 730 days → ~0.2
        score = math.exp(-age_days / 300)
        score = max(0.15, min(1.0, score))
        scores.append(score)

    return sum(scores) / len(scores)


# ── Corroboration score ───────────────────────────────────────

def _corroboration_score(num_sources: int, num_chunks: int) -> float:
    """
    More independent sources + chunks → higher corroboration.
    1 source  → 0.4
    2 sources → 0.7
    3+ sources → 0.9+
    """
    source_score = min(1.0, 0.4 + (num_sources - 1) * 0.25) if num_sources > 0 else 0.1
    chunk_score  = min(1.0, 0.3 + (num_chunks - 1) * 0.15)  if num_chunks > 0 else 0.1
    return (source_score + chunk_score) / 2


# ── LLM uncertainty detection ────────────────────────────────

UNCERTAINTY_PHRASES = [
    "insufficient information",
    "i don't have",
    "i do not have",
    "not available in",
    "no information",
    "please update",
    "could not find",
    "unable to find",
    "not mentioned",
    "not specified",
    "unclear from",
]

def _llm_certainty_penalty(answer_text: str) -> float:
    """Returns a penalty (0 = no penalty, 0.3 = heavy penalty) if the LLM expressed uncertainty."""
    t = answer_text.lower()
    for phrase in UNCERTAINTY_PHRASES:
        if phrase in t:
            return 0.30
    return 0.0


# ── Main scoring function ─────────────────────────────────────

def compute_confidence(
    chunks: list[dict],            # from retriever — each has "score", "source"
    answer_text: str,
    upload_dates: Optional[list[Optional[datetime]]] = None,
) -> dict:
    """
    Compute a confidence score for a generated RFP answer.

    Args:
        chunks: retrieval results with "score" (cosine similarity) and "source" keys
        answer_text: the generated answer string
        upload_dates: list of datetime objects for each source document (optional)

    Returns:
        {
            "score": 0.87,                     # overall 0.0–1.0
            "label": "high",                   # "high" | "medium" | "low"
            "color": "green",                  # for UI
            "breakdown": {...}                 # component scores
        }
    """
    if not chunks:
        return {
            "score": 0.10,
            "label": "low",
            "color": "red",
            "breakdown": {"semantic": 0.0, "source_quality": 0.0, "recency": 0.0, "corroboration": 0.0},
        }

    # 1. Semantic score — average cosine similarity of retrieved chunks
    semantic = sum(c.get("score", 0) for c in chunks) / len(chunks)
    semantic = max(0.0, min(1.0, float(semantic)))

    # 2. Source quality
    sources = list({c.get("source", "") for c in chunks})
    source_quality = _source_quality_score(sources)

    # 3. Recency
    dates = upload_dates or [c.get("upload_date") for c in chunks]
    recency = _recency_score(dates)

    # 4. Corroboration
    corroboration = _corroboration_score(len(sources), len(chunks))

    # 5. Weighted sum
    raw_score = (
        semantic      * WEIGHTS["semantic"] +
        source_quality * WEIGHTS["source_quality"] +
        recency       * WEIGHTS["recency"] +
        corroboration * WEIGHTS["corroboration"]
    )

    # 6. Apply LLM uncertainty penalty
    penalty = _llm_certainty_penalty(answer_text)
    final_score = max(0.05, round(raw_score - penalty, 3))

    # 7. Label
    if final_score >= 0.80:
        label, color = "high", "green"
    elif final_score >= 0.60:
        label, color = "medium", "amber"
    else:
        label, color = "low", "red"

    return {
        "score": final_score,
        "label": label,
        "color": color,
        "breakdown": {
            "semantic":       round(semantic, 3),
            "source_quality": round(source_quality, 3),
            "recency":        round(recency, 3),
            "corroboration":  round(corroboration, 3),
        },
    }


def format_confidence_for_slack(conf: dict) -> str:
    """Format confidence info as a Slack string."""
    score = conf["score"]
    label = conf["label"]
    emoji = {"high": ":large_green_circle:", "medium": ":large_yellow_circle:", "low": ":red_circle:"}.get(label, "")
    return f"{emoji} Confidence: *{score:.2f}* ({label.capitalize()})"


# ── CLI test ─────────────────────────────────────────────────

if __name__ == "__main__":
    from datetime import timedelta

    sample_chunks = [
        {"score": 0.92, "source": "Matters_DLP.pdf",    "upload_date": datetime.now(timezone.utc) - timedelta(days=10)},
        {"score": 0.87, "source": "Security_Guide.docx","upload_date": datetime.now(timezone.utc) - timedelta(days=45)},
        {"score": 0.81, "source": "PoC_Summary.pdf",    "upload_date": datetime.now(timezone.utc) - timedelta(days=5)},
    ]
    sample_answer = "Matters provides real-time DLP via continuous monitoring and ML anomaly detection."

    result = compute_confidence(sample_chunks, sample_answer)
    print(f"\nConfidence Score: {result['score']}")
    print(f"Label: {result['label']} ({result['color']})")
    print(f"Breakdown: {result['breakdown']}")
    print(f"Slack: {format_confidence_for_slack(result)}")