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

const validStatuses = ["active", "paused", "rejected_by_player", "archived"];

const handler = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") {
    return respond({ ok: false, error: { code: "method_not_allowed", message: "Используй POST." } }, 405);
  }

  let body: {
    investigation_id?: unknown;
    hypothesis_id?: unknown;
    request_id?: unknown;
    action?: unknown;
    title?: unknown;
    hypothesis_text?: unknown;
    status?: unknown;
    change_note?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return respond({ ok: false, error: { code: "invalid_json", message: "Тело запроса должно быть JSON." } }, 400);
  }

  if (!isUuid(body?.investigation_id) || !isUuid(body?.hypothesis_id) || !isUuid(body?.request_id)) {
    return respond({ ok: false, error: { code: "invalid_ids", message: "Проверь ID расследования, гипотезы и запроса." } }, 400);
  }

  const action = body.action;
  if (action !== "create" && action !== "revise" && action !== "set_status") {
    return respond({ ok: false, error: { code: "invalid_action", message: "Допустимые действия: create, revise, set_status." } }, 400);
  }

  if (action === "create" || action === "revise") {
    if (typeof body.title !== "string" || body.title.trim().length === 0 || body.title.length > 160 ||
        typeof body.hypothesis_text !== "string" || body.hypothesis_text.trim().length === 0 ||
        body.hypothesis_text.length > 10000) {
      return respond({ ok: false, error: { code: "invalid_hypothesis_content", message: "Укажи заголовок и текст версии. Максимум 160 и 10000 символов." } }, 400);
    }
  }

  if (action === "create" && body.status !== undefined &&
      !validStatuses.includes(String(body.status))) {
    return respond({ ok: false, error: { code: "invalid_status", message: "Недопустимый статус версии." } }, 400);
  }

  if (action === "set_status" && !validStatuses.includes(String(body.status))) {
    return respond({ ok: false, error: { code: "invalid_status", message: "Недопустимый статус версии." } }, 400);
  }

  if (body.change_note !== undefined && body.change_note !== null &&
      (typeof body.change_note !== "string" || body.change_note.length > 1000)) {
    return respond({ ok: false, error: { code: "invalid_change_note", message: "Комментарий к изменению не должен превышать 1000 символов." } }, 400);
  }

  const userId = ctx.userClaims?.id;
  if (!userId) {
    return respond({ ok: false, error: { code: "unauthorized", message: "Требуется вход в аккаунт." } }, 401);
  }

  const { data, error } = await ctx.supabaseAdmin
    .schema("game")
    .rpc("save_hypothesis_revision", {
      p_investigation_id: body.investigation_id,
      p_hypothesis_id: body.hypothesis_id,
      p_user_id: userId,
      p_request_id: body.request_id,
      p_action: action,
      p_title: typeof body.title === "string" ? body.title : null,
      p_hypothesis_text: typeof body.hypothesis_text === "string" ? body.hypothesis_text : null,
      p_status: typeof body.status === "string" ? body.status : null,
      p_change_note: typeof body.change_note === "string" ? body.change_note : null,
    });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("investigation_not_available") || message.includes("hypothesis_not_available")) {
      return respond({ ok: false, error: { code: "not_found_or_unavailable", message: "Расследование или версия недоступны." } }, 404);
    }
    if (message.includes("invalid_hypothesis_content") || message.includes("invalid_hypothesis_status") ||
        message.includes("invalid_action") || message.includes("change_note_too_long")) {
      return respond({ ok: false, error: { code: "invalid_hypothesis", message: "Проверь текст, статус и комментарий." } }, 400);
    }
    console.error("save_hypothesis_revision: database operation failed", error.code);
    return respond({ ok: false, error: { code: "save_hypothesis_failed", message: "Не удалось сохранить версию." } }, 500);
  }

  return respond({ ok: true, operation: "save_hypothesis_revision", hypothesis: data });
});

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return handler(req);
});
