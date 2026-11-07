import { withSupabase } from "npm:@supabase/server@1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const handler = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") {
    return respond({ ok: false, error: { code: "method_not_allowed", message: "Используй POST." } }, 405);
  }

  let body: {
    investigation_id?: unknown;
    puzzle_id?: unknown;
    request_id?: unknown;
    answer?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return respond({ ok: false, error: { code: "invalid_json", message: "Тело запроса должно быть JSON." } }, 400);
  }

  if (!isUuid(body?.investigation_id)) {
    return respond({ ok: false, error: { code: "invalid_investigation_id", message: "Укажи корректный investigation_id." } }, 400);
  }
  if (!isUuid(body?.puzzle_id)) {
    return respond({ ok: false, error: { code: "invalid_puzzle_id", message: "Укажи корректный puzzle_id." } }, 400);
  }
  if (!isUuid(body?.request_id)) {
    return respond({ ok: false, error: { code: "invalid_request_id", message: "Укажи UUID запроса для защиты от повторной отправки." } }, 400);
  }
  if (typeof body?.answer !== "string" || body.answer.length === 0 || body.answer.length > 2000) {
    return respond({ ok: false, error: { code: "invalid_answer", message: "Ответ должен содержать от 1 до 2000 символов." } }, 400);
  }

  const userId = ctx.userClaims?.id;
  if (!userId) {
    return respond({ ok: false, error: { code: "unauthorized", message: "Требуется вход в аккаунт." } }, 401);
  }

  const { data, error } = await ctx.supabaseAdmin
    .schema("game")
    .rpc("submit_puzzle_answer_atomic", {
      p_investigation_id: body.investigation_id,
      p_puzzle_id: body.puzzle_id,
      p_user_id: userId,
      p_request_id: body.request_id,
      p_answer: body.answer,
    });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("puzzle_rate_limited")) {
      return respond({ ok: false, error: { code: "puzzle_rate_limited", message: "Слишком много попыток. Подожди пять минут и попробуй снова." } }, 429);
    }
    if (message.includes("puzzle_locked")) {
      return respond({ ok: false, error: { code: "puzzle_locked", message: "Эта загадка пока недоступна." } }, 409);
    }
    if (message.includes("investigation_not_found") ||
        message.includes("puzzle_not_found") ||
        message.includes("puzzle_unavailable")) {
      return respond({ ok: false, error: { code: "not_found", message: "Загадка или расследование не найдены." } }, 404);
    }
    if (message.includes("investigation_not_active")) {
      return respond({ ok: false, error: { code: "investigation_not_active", message: "Это расследование уже нельзя продолжить." } }, 409);
    }
    if (message.includes("answer_key_unavailable") ||
        message.includes("invalid_answer_config")) {
      console.error("submit_puzzle_answer: author answer configuration invalid", error.code);
      return respond({ ok: false, error: { code: "puzzle_configuration_error", message: "Для этой загадки пока не настроена проверка ответа." } }, 503);
    }
    console.error("submit_puzzle_answer: database operation failed", error.code);
    return respond({ ok: false, error: { code: "submit_failed", message: "Не удалось проверить ответ." } }, 500);
  }

  return respond({
    ok: true,
    operation: "submit_puzzle_answer",
    result: data,
  });
});

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return handler(req);
});
