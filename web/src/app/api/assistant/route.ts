import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { SYSTEM_PROMPT, buildLiveContext, makeRateLimiter, validateMessages } from "@/lib/assistant";

/**
 * FLOPS assistant: answers questions with Claude, grounded in live market data from the keeper.
 * The Anthropic API key stays on the server (ANTHROPIC_API_KEY in Vercel); the browser only
 * sees the streamed answer text.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.ASSISTANT_MODEL || "claude-opus-5-5";
const KEEPER_URL = process.env.NEXT_PUBLIC_KEEPER_URL ?? "http://localhost:8787";
const allow = makeRateLimiter(Number(process.env.ASSISTANT_RATE_LIMIT || 15), 10 * 60_000);

let client: Anthropic | null = null;

export async function GET() {
  return NextResponse.json({ enabled: Boolean(process.env.ANTHROPIC_API_KEY) });
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "The assistant isn't set up on this site yet." }, { status: 503 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!allow(ip)) {
    return NextResponse.json({ error: "You're asking quickly. Please wait a few minutes and try again." }, { status: 429 });
  }
  const body = await req.json().catch(() => null);
  const checked = validateMessages(body?.messages);
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 });
  const page = typeof body?.page === "string" ? body.page.slice(0, 80) : undefined;

  const [markets, news, pool] = await Promise.all([
    keeper("/api/markets"),
    keeper("/api/news?limit=8"),
    keeper("/api/pool"),
  ]);
  const live = buildLiveContext({ markets: markets ?? undefined, news: news ?? undefined, pool, page });

  client ??= new Anthropic();
  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 2000,
    // Chat answers are short and mostly explanation, so low effort keeps them fast and cheap.
    output_config: { effort: "low" },
    // If a safety classifier declines, retry on Anthropic's recommended fallback model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    // Live data goes last as an operator (system) message, so the cached prefix stays stable.
    messages: [...checked.messages, { role: "system", content: live }],
  });

  const encoder = new TextEncoder();
  const body$ = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(encoder.encode("\n\nSorry, I can't help with that one. Try asking about FLOPS or the GPU markets."));
        } else if (final.stop_reason === "max_tokens") {
          controller.enqueue(encoder.encode("…"));
        }
      } catch (e) {
        console.error("[assistant]", e instanceof Anthropic.APIError ? `${e.status} ${e.message}` : e);
        const msg =
          e instanceof Anthropic.RateLimitError
            ? "The assistant is busy right now. Please try again in a minute."
            : e instanceof Anthropic.AuthenticationError
              ? "The assistant isn't set up correctly on this site."
              : "Something went wrong. Please try again.";
        controller.enqueue(encoder.encode(`\n\n${msg}`));
      } finally {
        controller.close();
      }
    },
    cancel() {
      stream.abort();
    },
  });

  return new Response(body$, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Best-effort read from the keeper; the assistant still answers if the keeper is down. */
async function keeper(path: string) {
  try {
    const res = await fetch(`${KEEPER_URL}${path}`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
