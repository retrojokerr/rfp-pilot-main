"""
retriever.py — Improved RAG pipeline

Key fixes over original:
  1. SYSTEM_PROMPT explicitly forbids repeating the question in the answer
  2. Confidence score computed on every response
  3. upload_date passed through from Qdrant payload for recency scoring
  4. Accepts pre-parsed ExtractedItem objects (from parser.py) for bulk RFP mode
"""

import os
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer
from ingest import qdrant
from groq import Groq
from confidence import compute_confidence, format_confidence_for_slack

load_dotenv()

# ── Init ─────────────────────────────────────────────────────

embedder = SentenceTransformer("BAAI/bge-small-en-v1.5")
groq_client = Groq(api_key=os.getenv("GROQ_API_KEY"))

COLLECTION = "rfi_knowledge_base"

# ── Improved system prompt ────────────────────────────────────
#
# Critical rules that fix the "question echoed in answer" bug:
#   - NEVER restate or paraphrase the question
#   - Answer starts directly with the capability statement
#   - Criteria/scoring text is never included

SYSTEM_PROMPT = """You are an expert pre-sales assistant helping respond to RFI/RFQ documents.

Respond in EXACTLY this format — nothing else, no extra text before or after:

AVAILABILITY: [Yes / No / Partial]
REMARKS: [Your response here]

━━━ CRITICAL RULES FOR REMARKS ━━━

1. DO NOT restate, repeat, or paraphrase the question in your answer.
   BAD:  "Regarding your question about encryption, Matters provides AES-256..."
   GOOD: "Matters provides AES-256 encryption for all data at rest..."

2. DO NOT include any evaluation criteria, scoring, or weightage in your answer.
   BAD:  "This is a mandatory requirement. Matters supports SSO via SAML 2.0..."
   GOOD: "Matters supports SSO via SAML 2.0, OAuth 2.0, and OpenID Connect..."

3. Start REMARKS immediately with the capability statement.
   Always begin with "Matters provides...", "Yes, Matters supports...", or similar.

4. Write in professional first-person vendor voice. Copy-paste ready for an RFI document.

5. Be specific: include feature names, protocols, standards, integrations.

6. 3–6 sentences max. No bullet points inside REMARKS — clean paragraph prose only.

7. Use ONLY information from the provided context. If insufficient, write:
   "Insufficient information in the current knowledge base. Please add relevant documents."

━━━ AVAILABILITY RULES ━━━
- "Yes"     → fully supported
- "No"      → not supported  
- "Partial" → partially supported or on the roadmap
"""


# ── Retrieve ──────────────────────────────────────────────────

def retrieve(query: str, top_k: int = 5) -> list[dict]:
    """
    Retrieve top_k most relevant chunks with an EXPLICIT two-tier priority:

      TIER 1 — Human corrections ("golden answers"), with source recorded.
               Corrections made in Slack, the Assistant, the Review Queue,
               or the RFI workspace ALWAYS outrank raw document chunks
               whenever they are relevantly similar (semantic >= 0.60).
               A very strong match (>= 0.75) short-circuits and is returned
               alone. Within the tier, newer corrections win close calls.

      TIER 2 — Knowledge-base documents, ranked by
               semantic * 0.7 + recency * 0.3, where recency decays from the
               document's modified date (Drive modifiedTime / upload date).

    Every correction chunk carries `correction_source` and `corrected_at`,
    and its `source` label is rendered as e.g.
    "[Correction] slack · 2026-05-12" so provenance is visible in the UI,
    exports, and Slack replies.
    """
    from datetime import datetime, timezone
    from qdrant_client.models import Filter, FieldCondition, MatchValue
    import math

    GOLDEN_SHORTCIRCUIT = 0.75   # this similar → answer with the correction alone
    GOLDEN_MIN_RELEVANCE = 0.60  # this similar → still outranks every document

    query_vector = embedder.encode(
        [query], normalize_embeddings=True
    ).tolist()[0]

    now = datetime.now(timezone.utc)

    def _recency(upload_date_str, half_life_days=300, default=0.5):
        if not upload_date_str:
            return default
        try:
            d = datetime.fromisoformat(upload_date_str)
            if d.tzinfo is None:
                d = d.replace(tzinfo=timezone.utc)
            return math.exp(-max((now - d).days, 0) / half_life_days)
        except Exception:
            return default

    def _qdrant_query(**kwargs):
        """Run qdrant.query_points with a few retries. "Connection reset by
        peer" and similar transient network errors (including a Cloud cluster
        waking from idle) usually clear on a second attempt. Raises the last
        exception if all attempts fail."""
        import time as _time
        last_exc = None
        for attempt in range(3):
            try:
                return qdrant.query_points(**kwargs)
            except Exception as e:  # noqa: BLE001 - retry any transport error
                last_exc = e
                if attempt < 2:
                    _time.sleep(0.5 * (attempt + 1))  # 0.5s, then 1.0s
                    print(f"  [retriever] Qdrant query retry "
                          f"{attempt + 1}/2 after: {e}")
        raise last_exc

    def _golden_label(payload):
        src = payload.get("correction_source") or "feedback"
        date = (payload.get("corrected_at") or payload.get("upload_date") or "")[:10]
        return f"[Correction] {src}" + (f" · {date}" if date else "")

    # ── TIER 1: human corrections ──────────────────────────────
    golden_chunks = []
    try:
        golden_results = _qdrant_query(
            collection_name=COLLECTION,
            query=query_vector,
            query_filter=Filter(
                must=[FieldCondition(
                    key="source_type",
                    match=MatchValue(value="golden_answer")
                )]
            ),
            limit=3,
            with_payload=True,
        ).points

        for r in golden_results:
            semantic = float(r.score)
            if semantic < GOLDEN_MIN_RELEVANCE:
                continue
            text = r.payload.get("text", "")
            # Extract just the answer part from stored "Q: ...\nA: ..." text
            answer_text = text.split("\nA: ", 1)[1] if "\nA: " in text else text
            recency = _recency(r.payload.get("corrected_at") or r.payload.get("upload_date"))
            golden_chunks.append({
                "text":              answer_text,
                "source":            _golden_label(r.payload),
                "score":             round(semantic, 3),
                "recency":           round(recency, 3),
                # Newest correction wins close calls within the tier
                "combined":          round(semantic * 0.6 + recency * 0.4, 3),
                "upload_date":       r.payload.get("upload_date"),
                "is_golden":         True,
                "correction_source": r.payload.get("correction_source", "feedback"),
                "corrected_at":      r.payload.get("corrected_at"),
            })

        golden_chunks.sort(key=lambda x: x["combined"], reverse=True)

        # Very strong correction match → it IS the answer, skip documents
        if golden_chunks and golden_chunks[0]["score"] >= GOLDEN_SHORTCIRCUIT:
            top = dict(golden_chunks[0], combined=1.0)
            print(f"  [retriever] Golden answer matched "
                  f"(score={top['score']:.3f}, source={top['correction_source']}): {query[:50]}")
            return [top]
    except Exception as e:
        print(f"  [retriever] Golden answer check failed: {e}")

    # ── TIER 2: knowledge-base documents ───────────────────────
    # Wrapped in retry + graceful degradation: a transient Qdrant reset here
    # must not 500 the whole /answer request. If it still fails after retries,
    # fall back to whatever golden chunks we have (possibly empty).
    try:
        results = _qdrant_query(
            collection_name=COLLECTION,
            query=query_vector,
            limit=top_k * 2,
            with_payload=True,
        ).points
    except Exception as e:
        print(f"  [retriever] Tier-2 document query failed after retries: {e}")
        return golden_chunks[:top_k]

    doc_chunks = []
    for r in results:
        if r.payload.get("source_type", "") == "golden_answer":
            continue  # corrections are handled exclusively in tier 1
        semantic = float(r.score)
        recency = _recency(r.payload.get("upload_date"))
        doc_chunks.append({
            "text":        r.payload.get("text", ""),
            "source":      r.payload.get("source_file", ""),
            "score":       round(semantic, 3),
            "recency":     round(recency, 3),
            "combined":    round(semantic * 0.7 + recency * 0.3, 3),
            "upload_date": r.payload.get("upload_date"),
            "is_golden":   False,
        })

    doc_chunks.sort(key=lambda x: x["combined"], reverse=True)

    # Tier 1 first, then tier 2 — a relevant human correction can never be
    # pushed below a raw document chunk, regardless of scores.
    return (golden_chunks + doc_chunks)[:top_k]


# ── Generate ──────────────────────────────────────────────────

def generate_answer(question: str, chunks: list[dict], max_retries: int = 3) -> str:
    """
    Generate a structured answer from retrieved chunks.

    IMPORTANT: `question` is the CLEAN question only — no criteria text.
    This is enforced by parser.py's _clean_question() before this is called.

    Includes automatic retry with exponential backoff on rate limits.
    """
    import time
    import re

    context = "\n\n---\n\n".join(
        f"[Source: {c['source']}]\n{c['text']}" for c in chunks
    )

    messages = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {
            "role": "user",
            "content": (
                f"Context from knowledge base:\n{context}\n\n"
                f"Question to answer: {question}\n\n"
                "Remember: Do NOT repeat the question. Start your REMARKS directly with the capability statement."
            ),
        },
    ]

    last_err = None
    for attempt in range(max_retries):
        try:
            from llm_provider import chat_completion
            return chat_completion(messages)
        except Exception as e:
            last_err = e
            err_str = str(e)

            # Check if it's a rate limit error
            if "429" in err_str or "rate_limit" in err_str.lower():
                # Try to parse the "try again in X seconds" hint
                wait_match = re.search(r"try again in (\d+)m([\d.]+)s", err_str)
                if wait_match:
                    minutes = int(wait_match.group(1))
                    seconds = float(wait_match.group(2))
                    wait_time = minutes * 60 + seconds
                    # Cap wait at 30s — anything longer is a hard daily limit
                    if wait_time > 30:
                        print(f"  Rate limit too long ({wait_time:.0f}s), giving up")
                        raise
                    print(f"  Rate limited, waiting {wait_time:.1f}s before retry {attempt+1}/{max_retries}")
                    time.sleep(wait_time + 1)
                    continue
                else:
                    # Exponential backoff: 2s, 4s, 8s
                    wait = 2 ** (attempt + 1)
                    print(f"  Rate limited, backing off {wait}s before retry {attempt+1}/{max_retries}")
                    time.sleep(wait)
                    continue

            # Not a rate limit error — fail immediately
            raise

    # Exhausted retries
    raise last_err


# ── Main ask function ─────────────────────────────────────────

def ask(query: str) -> dict:
    """
    Main entry point. Used by both Slack bot and web UI.

    Returns:
        {
            "answer": "AVAILABILITY: Yes\nREMARKS: ...",
            "sources": ["file1.pdf", ...],
            "chunks": [...],
            "confidence": {"score": 0.87, "label": "high", "color": "green", ...}
        }
    """
    chunks  = retrieve(query)
    answer  = generate_answer(query, chunks)
    sources = list({c["source"] for c in chunks})

    confidence = compute_confidence(chunks, answer)

    return {
        "answer":     answer,
        "sources":    sources,
        "chunks":     chunks,
        "confidence": confidence,
    }


# ── Bulk mode for parsed RFP documents ───────────────────────

def answer_rfp_items(items: list) -> list[dict]:
    """
    Generate answers for a list of ExtractedItem objects from parser.py.
    Used by the web UI's bulk processing mode.

    Returns list of dicts with the original item + answer + confidence.
    """
    results = []
    for item in items:
        result = ask(item.question)
        results.append({
            "id":          item.id,
            "section":     item.section,
            "subsection":  item.subsection,
            "question":    item.question,        # CLEAN question only
            "item_type":   item.item_type,
            "priority":    item.priority,
            "answer":      result["answer"],
            "sources":     result["sources"],
            "confidence":  result["confidence"],
        })
    return results


# ── Test ──────────────────────────────────────────────────────

if __name__ == "__main__":
    print("Testing improved retriever...\n")

    test_questions = [
        "Do you support real-time data loss prevention?",
        "Describe your encryption standards for data at rest and in transit.",
        "What compliance certifications do you hold?",
    ]

    for q in test_questions:
        print(f"Q: {q}")
        result = ask(q)
        print(f"A:\n{result['answer']}")
        conf = result["confidence"]
        print(f"\nConfidence: {conf['score']} ({conf['label']})")
        print(f"Sources: {result['sources']}")
        print("-" * 60)