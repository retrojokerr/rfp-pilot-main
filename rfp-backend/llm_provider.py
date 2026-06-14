"""
llm_provider.py — single place that talks to the LLM.

Switch providers/models with ENV VARS ONLY — no code changes:

    LLM_PROVIDER=groq        # groq | anthropic | openai
    LLM_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
    LLM_API_KEY=...          # the provider's key
    LLM_TEMPERATURE=0.1      # optional
    LLM_MAX_TOKENS=600       # optional

Examples:
    # Groq (current)
    LLM_PROVIDER=groq
    LLM_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
    LLM_API_KEY=gsk_...

    # Claude
    LLM_PROVIDER=anthropic
    LLM_MODEL=claude-sonnet-4-5
    LLM_API_KEY=sk-ant-...

    # OpenAI
    LLM_PROVIDER=openai
    LLM_MODEL=gpt-4o
    LLM_API_KEY=sk-...

Backwards compatible: if LLM_* are unset, falls back to GROQ_API_KEY and the
original default model, so existing deployments keep working untouched.
"""

import os


class LLMConfig:
    """Resolved once at import; reflects the current env."""
    def __init__(self):
        # Back-compat: old deployments only set GROQ_API_KEY
        # `or default` catches BOTH unset (None) and empty-string ("") values,
        # so a blank secret in the secrets manager still falls back correctly.
        self.provider = (os.getenv("LLM_PROVIDER") or "groq").lower().strip()
        self.model = (os.getenv("LLM_MODEL") or "meta-llama/llama-4-scout-17b-16e-instruct").strip()
        self.api_key = os.getenv("LLM_API_KEY") or os.getenv("GROQ_API_KEY")
        self.temperature = float(os.getenv("LLM_TEMPERATURE") or "0.1")
        self.max_tokens = int(os.getenv("LLM_MAX_TOKENS") or "600")

    def masked_key(self) -> str:
        if not self.api_key:
            return "(not set)"
        k = self.api_key
        return f"{k[:6]}…{k[-4:]}" if len(k) > 12 else "***"


CONFIG = LLMConfig()


# ── Provider adapters — all return a plain string ─────────────

def _call_groq(messages, cfg: LLMConfig) -> str:
    from groq import Groq
    client = Groq(api_key=cfg.api_key)
    resp = client.chat.completions.create(
        model=cfg.model,
        messages=messages,
        temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
    )
    return resp.choices[0].message.content.strip()


def _call_openai(messages, cfg: LLMConfig) -> str:
    from openai import OpenAI
    client = OpenAI(api_key=cfg.api_key)
    resp = client.chat.completions.create(
        model=cfg.model,
        messages=messages,
        temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
    )
    return resp.choices[0].message.content.strip()


def _call_anthropic(messages, cfg: LLMConfig) -> str:
    from anthropic import Anthropic
    client = Anthropic(api_key=cfg.api_key)
    # Anthropic takes the system prompt separately from the messages list
    system_prompt = ""
    convo = []
    for m in messages:
        if m["role"] == "system":
            system_prompt += m["content"] + "\n"
        else:
            convo.append({"role": m["role"], "content": m["content"]})
    resp = client.messages.create(
        model=cfg.model,
        system=system_prompt.strip() or None,
        messages=convo,
        temperature=cfg.temperature,
        max_tokens=cfg.max_tokens,
    )
    # Anthropic returns a list of content blocks
    return "".join(block.text for block in resp.content if block.type == "text").strip()


_PROVIDERS = {
    "groq": _call_groq,
    "openai": _call_openai,
    "anthropic": _call_anthropic,
}


def chat_completion(messages: list[dict]) -> str:
    """
    Provider-agnostic completion. `messages` is the standard
    [{"role": "system"|"user"|"assistant", "content": "..."}] list.
    Raises if the provider/key is misconfigured.
    """
    cfg = CONFIG
    if not cfg.api_key:
        raise RuntimeError(
            "No LLM API key configured. Set LLM_API_KEY (or GROQ_API_KEY)."
        )
    fn = _PROVIDERS.get(cfg.provider)
    if not fn:
        raise RuntimeError(
            f"Unknown LLM_PROVIDER '{cfg.provider}'. "
            f"Supported: {', '.join(_PROVIDERS)}"
        )
    return fn(messages, cfg)


def is_rate_limit_error(err: Exception) -> bool:
    """Provider-agnostic rate-limit detection."""
    s = str(err).lower()
    return "429" in s or "rate_limit" in s or "rate limit" in s or "overloaded" in s