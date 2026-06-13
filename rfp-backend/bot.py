"""
bot.py — Slack bot with feedback loop

Feedback signals captured:
  - 👍 reaction on a bot message → positive signal
  - 👎 reaction on a bot message → negative signal + DM asking for correction
  - User replies with correction in thread → stored as feedback pair
  - Saved to feedback_log.jsonl for fine-tuning export
"""

import os
import re
import json
import httpx
import threading
from datetime import datetime, timezone
from pathlib import Path
from dotenv import load_dotenv
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler
from retriever import ask
from confidence import format_confidence_for_slack

load_dotenv()

app = App(token=os.getenv("SLACK_BOT_TOKEN"))

# ── Feedback storage ──────────────────────────────────────────
# In-memory store mapping message_ts → {question, answer, channel, user}
# Persisted to feedback_log.jsonl on disk

FEEDBACK_LOG = Path("feedback_log.jsonl")
pending_feedback: dict = {}   # ts → {question, answer, confidence, channel}
awaiting_correction: dict = {}  # user_id → {question, bad_answer, confidence} — confirmed they want to correct
pending_correction_ask: dict = {}  # user_id → pending data — waiting for Yes/No


def log_feedback(entry: dict):
    """Append a feedback entry to the JSONL log file."""
    entry["logged_at"] = datetime.now(timezone.utc).isoformat()
    with open(FEEDBACK_LOG, "a") as f:
        f.write(json.dumps(entry) + "\n")
    print(f"  [feedback] {entry['signal']} — {entry['question'][:60]}")


def get_feedback_stats() -> str:
    """Return a summary of feedback collected."""
    if not FEEDBACK_LOG.exists():
        return "No feedback collected yet."
    lines = FEEDBACK_LOG.read_text().strip().splitlines()
    entries = [json.loads(l) for l in lines if l.strip()]
    thumbs_up   = sum(1 for e in entries if e.get("signal") == "thumbs_up")
    thumbs_down = sum(1 for e in entries if e.get("signal") == "thumbs_down")
    corrections = sum(1 for e in entries if e.get("good_answer"))
    return (
        f":bar_chart: *Feedback summary*\n"
        f"• 👍 Positive: {thumbs_up}\n"
        f"• 👎 Negative: {thumbs_down}\n"
        f"• ✏️ Corrections: {corrections}\n"
        f"• Total pairs: {len(entries)}"
    )


# ── LLM message classifier ─────────────────────────────────────

def extract_query(text: str) -> tuple:
    prompt = f"""You are a classifier for an RFI/RFQ chatbot.

Analyze this message and respond with JSON only:

Message: "{text}"

PRIORITY RULE: If the message contains ANY product/capability question — even if it starts with a greeting — ALWAYS classify it as a query and extract just the question part.

Rules:
- If it contains a real product/capability question, return:
  {{"is_query": true, "query": "<extracted question only, without greeting>", "reply": null}}
- ONLY if the message has NO question at all, return:
  {{"is_query": false, "query": null, "reply": "<your short reply>"}}

Reply tone (when no question):
- Pure greetings ("hi", "hello") → return reply as exactly: "USE_HELP_MSG"
- Acknowledgements ("ok", "sure") → "Sure, take your time!"
- Gratitude ("thanks") → "You're welcome! Feel free to ask anything else."
- Farewell ("bye") → "Goodbye! Come back anytime."
- Other unclear → "I'm here to help with RFI/RFQ questions!"

Respond with valid JSON only."""

    try:
        response = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {os.getenv('GROQ_API_KEY')}",
                "Content-Type": "application/json",
            },
            json={
                "model": "llama-3.1-8b-instant",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
                "max_tokens": 100,
            },
            timeout=5.0,
        )
        content = response.json()["choices"][0]["message"]["content"].strip()
        parsed  = json.loads(content)

        if parsed.get("is_query"):
            return parsed.get("query"), None

        reply = parsed.get("reply") or "USE_HELP_MSG"
        if reply == "USE_HELP_MSG":
            return None, None
        return None, reply

    except Exception:
        return text, None


# ── Help message ───────────────────────────────────────────────

HELP_MSG = (
    "Hi there! :wave: I'm your RFI/RFQ assistant.\n\n"
    "Ask me anything about our product capabilities. For example:\n"
    "• _Do you support database activity monitoring?_\n"
    "• _What cloud platforms do you support?_\n"
    "• _Do you integrate with SIEM platforms?_\n\n"
    "_React with 👍 if an answer is helpful, 👎 to flag and correct it._\n"
    "_Every answer includes a confidence score._"
)


# ── Format response ────────────────────────────────────────────

def format_response(result: dict) -> tuple[str, list]:
    """Returns (fallback_text, blocks) for Slack Block Kit."""
    answer  = result["answer"]
    sources = result["sources"]
    conf    = result.get("confidence", {})

    availability = ""
    remarks      = ""

    for line in answer.split("\n"):
        line = line.strip()
        if line.startswith("AVAILABILITY:"):
            availability = line.replace("AVAILABILITY:", "").strip()
        elif line.startswith("REMARKS:"):
            remarks = line.replace("REMARKS:", "").strip()

    placeholders = {"[yes / no / partial]", "[your detailed response here]", ""}
    if availability.lower() in placeholders or remarks.lower() in placeholders:
        return ":warning: No relevant information found.", []

    avail_lower = availability.lower()
    if avail_lower == "yes":
        emoji = ":white_check_mark:"
    elif avail_lower == "no":
        emoji = ":x:"
    else:
        emoji = ":large_yellow_circle:"

    source_str = "  ".join(f"`{s}`" for s in sources) if sources else "_No source found_"
    conf_line = format_confidence_for_slack(conf) if conf else ""

    fallback = f"{emoji} {availability} — {remarks[:100]}"

    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"{emoji} *Response: {availability}*\n\n{remarks}"
            }
        },
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": f":books: *Sources:* {source_str}"},
            ]
        },
    ]

    if conf_line:
        blocks.append({
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": conf_line}]
        })

    # 👍 👎 action buttons
    blocks.append({"type": "divider"})
    blocks.append({
        "type": "actions",
        "elements": [
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "👍 Helpful", "emoji": True},
                "style": "primary",
                "action_id": "feedback_thumbs_up",
                "value": json.dumps({
                    "question": result.get("query", ""),
                    "answer":   answer,
                    "confidence": conf.get("score", 0) if conf else 0,
                }),
            },
            {
                "type": "button",
                "text": {"type": "plain_text", "text": "👎 Needs correction", "emoji": True},
                "style": "danger",
                "action_id": "feedback_thumbs_down",
                "value": json.dumps({
                    "question": result.get("query", ""),
                    "answer":   answer,
                    "confidence": conf.get("score", 0) if conf else 0,
                }),
            },
        ]
    })

    return fallback, blocks


# ── Event: app mention ─────────────────────────────────────────

@app.event("app_mention")
def handle_mention(event, say, client):
    raw_text = re.sub(r"<@[A-Z0-9]+>", "", event.get("text", "")).strip()

    # Special commands
    if raw_text.lower() in ("feedback", "feedback stats", "stats"):
        say(text=get_feedback_stats(), thread_ts=event.get("ts"))
        return

    if not raw_text:
        say(text=HELP_MSG, thread_ts=event.get("ts"))
        return

    query, chit_reply = extract_query(raw_text)

    if chit_reply:
        say(text=chit_reply, thread_ts=event.get("ts"))
        return

    if not query:
        say(text=HELP_MSG, thread_ts=event.get("ts"))
        return

    say(text=":mag: Searching knowledge base...", thread_ts=event["ts"])

    try:
        result["query"] = query
        result   = ask(query)
        result["query"] = query
        fallback, blocks = format_response(result)
        msg = say(text=fallback, blocks=blocks, thread_ts=event["ts"])

        # Store for feedback tracking
        if msg:
            pending_feedback[msg["ts"]] = {
                "question":   query,
                "answer":     result.get("answer", ""),
                "confidence": result.get("confidence", {}).get("score", 0),
                "channel":    event["channel"],
            }
    except Exception as e:
        say(text=f":warning: Something went wrong: {str(e)}", thread_ts=event["ts"])


# ── Event: DM ─────────────────────────────────────────────────

@app.event("message")
def handle_dm(event, say, client):
    if event.get("bot_id"):
        return

    channel_type = event.get("channel_type")
    user = event.get("user")

    # Handle correction replies (user previously gave 👎 and we asked for correction)
    if user and user in awaiting_correction:
        pending = awaiting_correction.pop(user)
        correction = event.get("text", "").strip()
        if correction:
            log_feedback({
                "question":    pending["question"],
                "bad_answer":  pending["bad_answer"],
                "good_answer": correction,
                "confidence":  pending["confidence"],
                "signal":      "correction",
                "source":      "slack",
                "user":        user,
            })

            # Ingest correction directly into Qdrant for immediate improvement
            api_url = os.getenv("API_URL", "http://localhost:8000")
            try:
                resp = httpx.post(
                    f"{api_url}/feedback/ingest",
                    json={
                        "question":   pending["question"],
                        "good_answer": correction,
                        "section":    "",
                        "source":     "slack",
                    },
                    timeout=10.0,
                )
                if resp.status_code == 200:
                    ingest_status = ":white_check_mark: *Ingested into knowledge base*"
                else:
                    ingest_status = ":warning: Saved locally (backend unavailable)"
            except Exception:
                ingest_status = ":warning: Saved locally (backend unavailable)"

            say(text=(
                f":white_check_mark: *Correction saved — thank you!*\n"
                f"{ingest_status}\n\n"
                "Future answers to this question will use your correction."
            ))
        return

    if channel_type != "im":
        return

    query_raw = event.get("text", "").strip()
    if not query_raw:
        return

    # Special commands in DM
    if query_raw.lower() in ("feedback", "stats"):
        say(text=get_feedback_stats())
        return

    query, chit_reply = extract_query(query_raw)

    if chit_reply:
        say(text=chit_reply)
        return

    if not query:
        say(text=HELP_MSG)
        return

    say(text=":mag: Searching knowledge base...")

    try:
        result   = ask(query)
        result["query"] = query
        fallback, blocks = format_response(result)
        msg = say(text=fallback, blocks=blocks)

        # Store for feedback
        if msg:
            pending_feedback[msg["ts"]] = {
                "question":   query,
                "answer":     result.get("answer", ""),
                "confidence": result.get("confidence", {}).get("score", 0),
                "channel":    event["channel"],
            }
    except Exception as e:
        say(text=f":warning: Something went wrong: {str(e)}")


# ── Event: emoji reactions ─────────────────────────────────────

@app.event("reaction_added")
def handle_reaction(event, client):
    reaction  = event.get("reaction")
    item      = event.get("item", {})
    msg_ts    = item.get("ts")
    channel   = item.get("channel")
    user      = event.get("user")

    # Only care about reactions on tracked messages
    if msg_ts not in pending_feedback:
        return

    pending = pending_feedback[msg_ts]

    if reaction == "+1":   # 👍
        log_feedback({
            "question":   pending["question"],
            "bad_answer": "",
            "good_answer": pending["answer"],
            "confidence": pending["confidence"],
            "signal":     "thumbs_up",
            "source":     "slack",
            "user":       user,
        })

    elif reaction == "-1":  # 👎
        log_feedback({
            "question":   pending["question"],
            "bad_answer": pending["answer"],
            "good_answer": "",
            "confidence": pending["confidence"],
            "signal":     "thumbs_down",
            "source":     "slack",
            "user":       user,
        })

        # DM the user asking for the correct answer
        awaiting_correction[user] = {
            "question":   pending["question"],
            "bad_answer": pending["answer"],
            "confidence": pending["confidence"],
        }

        try:
            # Open DM channel with user
            dm = client.conversations_open(users=user)
            dm_channel = dm["channel"]["id"]
            client.chat_postMessage(
                channel=dm_channel,
                text=(
                    ":pencil2: *Thanks for the feedback!*\n\n"
                    f"You flagged this answer as incorrect:\n"
                    f"> *Question:* {pending['question']}\n\n"
                    "What should the correct answer have been? "
                    "Reply here and I'll save it to improve future responses."
                )
            )
        except Exception as e:
            print(f"  [feedback] Could not DM user: {e}")




# ── Action handlers: feedback buttons ─────────────────────────

@app.action("feedback_thumbs_up")
def handle_thumbs_up(ack, body, client):
    ack()
    user    = body["user"]["id"]
    payload = json.loads(body["actions"][0]["value"])

    log_feedback({
        "question":   payload.get("question", ""),
        "bad_answer": "",
        "good_answer": payload.get("answer", ""),
        "confidence": payload.get("confidence", 0),
        "signal":     "thumbs_up",
        "source":     "slack",
        "user":       user,
    })

    # Update message to show feedback received
    try:
        client.chat_update(
            channel=body["channel"]["id"],
            ts=body["message"]["ts"],
            text="✅ Answer marked as helpful",
            blocks=[
                {
                    "type": "context",
                    "elements": [{"type": "mrkdwn", "text": "✅ *Marked as helpful* — thank you for the feedback!"}]
                }
            ] + body["message"].get("blocks", [])[:-2]  # Remove the button block
        )
    except Exception:
        pass


@app.action("feedback_thumbs_down")
def handle_thumbs_down(ack, body, client):
    ack()
    user    = body["user"]["id"]
    payload = json.loads(body["actions"][0]["value"])

    log_feedback({
        "question":   payload.get("question", ""),
        "bad_answer": payload.get("answer", ""),
        "good_answer": "",
        "confidence": payload.get("confidence", 0),
        "signal":     "thumbs_down",
        "source":     "slack",
        "user":       user,
    })

    # Store temporarily in case user agrees to provide correction
    pending_correction_ask[user] = {
        "question":   payload.get("question", ""),
        "bad_answer": payload.get("answer", ""),
        "confidence": payload.get("confidence", 0),
    }

    try:
        # Ask via DM — give user the choice, don't assume they want to correct
        dm = client.conversations_open(users=user)
        dm_channel = dm["channel"]["id"]
        client.chat_postMessage(
            channel=dm_channel,
            text="Thanks for the feedback! Would you like to provide the correct answer?",
            blocks=[
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": (
                            ":thumbsdown: *Thanks for flagging that answer!*\n\n"
                            f"Question: _{payload.get('question', '')[:200]}_\n\n"
                            "Would you like to provide the correct answer? "
                            "This helps improve future responses."
                        )
                    }
                },
                {
                    "type": "actions",
                    "elements": [
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "Yes, I'll correct it", "emoji": True},
                            "style": "primary",
                            "action_id": "correction_yes",
                            "value": json.dumps(pending_correction_ask[user]),
                        },
                        {
                            "type": "button",
                            "text": {"type": "plain_text", "text": "No thanks", "emoji": True},
                            "action_id": "correction_no",
                            "value": "no",
                        },
                    ]
                }
            ]
        )
        # Update original message
        client.chat_update(
            channel=body["channel"]["id"],
            ts=body["message"]["ts"],
            text="👎 Flagged",
            blocks=[
                {
                    "type": "context",
                    "elements": [{"type": "mrkdwn", "text": "👎 *Flagged as incorrect* — thank you for the feedback."}]
                }
            ] + body["message"].get("blocks", [])[:-2]
        )
    except Exception as e:
        print(f"  [feedback] Could not DM user: {e}")


@app.action("correction_yes")
def handle_correction_yes(ack, body, client):
    ack()
    user    = body["user"]["id"]
    payload = json.loads(body["actions"][0]["value"])

    # Store for next DM reply
    awaiting_correction[user] = payload

    # Update the DM to ask for the correction text
    try:
        client.chat_update(
            channel=body["channel"]["id"],
            ts=body["message"]["ts"],
            text="Please type the correct answer below.",
            blocks=[
                {
                    "type": "section",
                    "text": {
                        "type": "mrkdwn",
                        "text": (
                            ":pencil2: *Great! Please type the correct answer below.*\n\n"
                            f"Question: _{payload.get('question', '')[:200]}_\n\n"
                            "Just reply to this DM with the correct answer."
                        )
                    }
                }
            ]
        )
    except Exception as e:
        print(f"  [feedback] Could not update DM: {e}")


@app.action("correction_no")
def handle_correction_no(ack, body, client):
    ack()
    user = body["user"]["id"]
    # Clear any pending state
    pending_correction_ask.pop(user, None)
    awaiting_correction.pop(user, None)

    try:
        client.chat_update(
            channel=body["channel"]["id"],
            ts=body["message"]["ts"],
            text="No problem!",
            blocks=[
                {
                    "type": "context",
                    "elements": [{"type": "mrkdwn", "text": "No problem! Your feedback has been recorded. :+1:"}]
                }
            ]
        )
    except Exception as e:
        print(f"  [feedback] Could not update DM: {e}")

# ── Start ──────────────────────────────────────────────────────

if __name__ == "__main__":
    print("RFI Bot v2 starting with feedback loop...")
    print(f"  Feedback log: {FEEDBACK_LOG.resolve()}")
    SocketModeHandler(app, os.getenv("SLACK_APP_TOKEN")).start()