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
    return respond({ ok: false, error: { code: "invalid_request_id", message: "Укажи UUID запроса для защиты от повторной выдачи подсказки." } }, 400);
  }

  const userId = ctx.userClaims?.id;
  if (!userId) {
    return respond({ ok: false, error: { code: "unauthorized", message: "Требуется вход в аккаунт." } }, 401);
  }

  const { data, error } = await ctx.supabaseAdmin
    .schema("game")
    .rpc("request_hint_atomic", {
      p_investigation_id: body.investigation_id,
      p_puzzle_id: body.puzzle_id,
      p_user_id: userId,
      p_request_id: body.request_id,
    });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("puzzle_unavailable") || message.includes("puzzle_not_found") ||
        message.includes("investigation_not_found")) {
      return respond({ ok: false, error: { code: "not_found", message: "Загадка или расследование не найдены." } }, 404);
    }
    if (message.includes("investigation_not_active")) {
      return respond({ ok: false, error: { code: "investigation_not_active", message: "Это расследование уже нельзя продолжить." } }, 409);
    }
    if (message.includes("puzzle_already_solved")) {
      return respond({ ok: false, error: { code: "puzzle_already_solved", message: "Эта загадка уже решена." } }, 409);
    }
    if (message.includes("no_more_hints")) {
      return respond({ ok: false, error: { code: "no_more_hints", message: "Для этой загадки больше нет подсказок." } }, 409);
    }
    if (message.includes("hint_not_configured")) {
      console.error("request_hint: missing sequential hint level", error.code);
      return respond({ ok: false, error: { code: "hint_not_configured", message: "Следующая подсказка пока не подготовлена." } }, 503);
    }
    console.error("request_hint: database operation failed", error.code);
    return respond({ ok: false, error: { code: "hint_request_failed", message: "Не удалось выдать подсказку." } }, 500);
  }

  return respond({
    ok: true,
    operation: "request_hint",
    hint: data,
  });
});

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return handler(req);
});
