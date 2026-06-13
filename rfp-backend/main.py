import os
import re
import json
import httpx
from dotenv import load_dotenv
from slack_bolt import App
from slack_bolt.adapter.socket_mode import SocketModeHandler
from retriever import ask

load_dotenv()

app = App(token=os.getenv("SLACK_BOT_TOKEN"))


# ── LLM-powered message classifier ──────────────────────────
def extract_query(text: str) -> tuple[str | None, str | None]:
    """
    Returns (query, chit_chat_reply)
    - If real query: (extracted_query, None)
    - If chit-chat:  (None, appropriate_reply) or (None, None) for greetings → triggers HELP_MSG
    """
    prompt = f"""You are a classifier for an RFI/RFQ chatbot.

Analyze this message and respond with JSON only:

Message: "{text}"

PRIORITY RULE: If the message contains ANY product/capability question — even if it starts with a greeting — ALWAYS classify it as a query and extract just the question part.

Rules:
- If it contains a real product/capability question (even prefixed with hi/hello/hey), return:
  {{"is_query": true, "query": "<extracted question only, without the greeting>", "reply": null}}

- ONLY if the message has NO question at all (pure greetings, chit-chat, reactions, filler words), return:
  {{"is_query": false, "query": null, "reply": "<your short reply>"}}

Reply tone guide (only used when there is truly no question):
- Pure greetings only ("hi", "hello", "hey", "Hi I am X") → ALWAYS return reply as exactly: "USE_HELP_MSG"
- Acknowledgements ("ok", "ok wait", "ok so", "sure", "got it") → "Sure, take your time!" or "Whenever you're ready!"
- Gratitude ("thanks", "thank you") → "You're welcome! Feel free to ask anything else."
- Rude/frustrated ("shut up", "this is useless") → "I'm sorry if I wasn't helpful. I'm here whenever you have a product question."
- Confusion ("what?", "huh?") → "No worries! Feel free to ask me anything about our product capabilities."
- Farewell ("bye", "goodbye") → "Goodbye! Come back anytime you have questions."
- Anything else unclear → "I'm here to help with RFI/RFQ questions. Feel free to ask anything about our product capabilities!"

Examples:
- "Hi so do you integrate with SIEM platforms?" → {{"is_query": true, "query": "do you integrate with SIEM platforms?", "reply": null}}
- "Hello we need data discovery capabilities" → {{"is_query": true, "query": "do you have data discovery capabilities?", "reply": null}}
- "Hi" → {{"is_query": false, "query": null, "reply": "USE_HELP_MSG"}}
- "Hi I am Subandhu" → {{"is_query": false, "query": null, "reply": "USE_HELP_MSG"}}
- "thanks" → {{"is_query": false, "query": null, "reply": "You're welcome! Feel free to ask anything else."}}

Respond with valid JSON only, no explanation."""

    try:
        response = httpx.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {os.getenv('GROQ_API_KEY')}",
                "Content-Type": "application/json"
            },
            json={
                "model": "llama-3.1-8b-instant",
                "messages": [{"role": "user", "content": prompt}],
                "temperature": 0.3,
                "max_tokens": 100
            },
            timeout=5.0
        )
        content = response.json()["choices"][0]["message"]["content"].strip()
        parsed  = json.loads(content)

        if parsed.get("is_query"):
            return parsed.get("query"), None

        reply = parsed.get("reply") or "USE_HELP_MSG"
        if reply == "USE_HELP_MSG":
            return None, None  # triggers HELP_MSG in the handler
        return None, reply

    except Exception:
        return text, None


# ── Help message ─────────────────────────────────────────────
HELP_MSG = (
    "Hi there! :wave: I'm your RFI/RFQ assistant.\n\n"
    "Ask me anything about our product capabilities. For example:\n"
    "• _Do you support database activity monitoring?_\n"
    "• _What cloud platforms do you support?_\n"
    "• _Do you integrate with SIEM platforms?_"
)


# ── Format bot response ──────────────────────────────────────
def format_response(result: dict) -> str:
    answer  = result["answer"]
    sources = result["sources"]

    availability = ""
    remarks      = ""

    for line in answer.split("\n"):
        line = line.strip()
        if line.startswith("AVAILABILITY:"):
            availability = line.replace("AVAILABILITY:", "").strip()
        elif line.startswith("REMARKS:"):
            remarks = line.replace("REMARKS:", "").strip()

    # Catch placeholder / empty responses from LLM
    placeholders = {"[yes / no / partial]", "[your detailed response here]", ""}
    if availability.lower() in placeholders or remarks.lower() in placeholders:
        return ":warning: I couldn't find relevant information in the knowledge base. Please make sure the related documents have been ingested."

    # Pick emoji
    if availability.lower() == "yes":
        emoji = ":white_check_mark:"
    elif availability.lower() == "no":
        emoji = ":x:"
    else:
        emoji = ":large_yellow_circle:"

    source_lines = "\n".join(f"• `{s}`" for s in sources)

    response  = f"{emoji} *Response:* {availability}\n\n"
    response += f"*Remarks:*\n{remarks}\n\n"
    response += f"─────────────────────\n"
    response += f":books: *Sources:* {source_lines}"

    return response


# ── Handle @mentions in channels ────────────────────────────
@app.event("app_mention")
def handle_mention(event, say):
    raw_query = re.sub(r"<@[A-Z0-9]+>", "", event["text"]).strip()
    query, chit_chat_reply = extract_query(raw_query)

    if not query:
        say(text=chit_chat_reply or HELP_MSG, thread_ts=event.get("ts"))
        return

    say(text=":mag: Searching knowledge base...", thread_ts=event["ts"])

    try:
        result   = ask(query)
        response = format_response(result)
        say(text=response, thread_ts=event["ts"])
    except Exception as e:
        say(text=f":warning: Something went wrong: {str(e)}", thread_ts=event["ts"])


# ── Handle Direct Messages ───────────────────────────────────
@app.event("message")
def handle_dm(event, say):
    if event.get("channel_type") != "im":
        return
    if event.get("bot_id"):
        return

    raw_query = event.get("text", "").strip()
    if not raw_query:
        return

    query, chit_chat_reply = extract_query(raw_query)
    if not query:
        say(text=chit_chat_reply or HELP_MSG)
        return

    say(text=":mag: Searching knowledge base...")

    try:
        result   = ask(query)
        response = format_response(result)
        say(text=response)
    except Exception as e:
        say(text=f":warning: Something went wrong: {str(e)}")


# ── Start ────────────────────────────────────────────────────
if __name__ == "__main__":
    print("RFI Bot is starting...")
    print("You can now ask questions in Slack!")
    print("  - DM the bot directly")
    print("  - @mention the bot in any channel")
    SocketModeHandler(app, os.getenv("SLACK_APP_TOKEN")).start()