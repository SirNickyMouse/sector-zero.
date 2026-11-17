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
    note_id?: unknown;
    request_id?: unknown;
    action?: unknown;
    title?: unknown;
    body?: unknown;
    related_material_id?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return respond({ ok: false, error: { code: "invalid_json", message: "Тело запроса должно быть JSON." } }, 400);
  }

  if (!isUuid(body?.investigation_id)) {
    return respond({ ok: false, error: { code: "invalid_investigation_id", message: "Укажи корректный investigation_id." } }, 400);
  }
  if (!isUuid(body?.note_id)) {
    return respond({ ok: false, error: { code: "invalid_note_id", message: "Укажи UUID заметки." } }, 400);
  }
  if (!isUuid(body?.request_id)) {
    return respond({ ok: false, error: { code: "invalid_request_id", message: "Укажи UUID операции для защиты от повторной записи." } }, 400);
  }

  const action = body.action;
  if (action !== "save" && action !== "delete" && action !== "restore") {
    return respond({ ok: false, error: { code: "invalid_action", message: "Допустимые действия: save, delete, restore." } }, 400);
  }

  if (action === "save") {
    if (typeof body.body !== "string" || body.body.trim().length === 0 || body.body.length > 20000) {
      return respond({ ok: false, error: { code: "invalid_body", message: "Текст заметки должен содержать от 1 до 20000 символов." } }, 400);
    }
    if (body.title !== undefined && body.title !== null &&
        (typeof body.title !== "string" || body.title.length > 160)) {
      return respond({ ok: false, error: { code: "invalid_title", message: "Заголовок не должен превышать 160 символов." } }, 400);
    }
    if (body.related_material_id !== undefined && body.related_material_id !== null &&
        !isUuid(body.related_material_id)) {
      return respond({ ok: false, error: { code: "invalid_material_id", message: "Некорректный ID документа." } }, 400);
    }
  }

  const userId = ctx.userClaims?.id;
  if (!userId) {
    return respond({ ok: false, error: { code: "unauthorized", message: "Требуется вход в аккаунт." } }, 401);
  }

  const { data, error } = await ctx.supabaseAdmin
    .schema("game")
    .rpc("save_note_atomic", {
      p_investigation_id: body.investigation_id,
      p_note_id: body.note_id,
      p_user_id: userId,
      p_request_id: body.request_id,
      p_action: action,
      p_title: typeof body.title === "string" ? body.title : null,
      p_body: typeof body.body === "string" ? body.body : null,
      p_related_material_id: isUuid(body.related_material_id) ? body.related_material_id : null,
    });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("investigation_not_available") ||
        message.includes("note_not_available") ||
        message.includes("related_material_not_opened")) {
      return respond({ ok: false, error: { code: "not_found_or_unavailable", message: "Расследование, заметка или открытый документ не найдены." } }, 404);
    }
    if (message.includes("note_body_required") || message.includes("note_too_long") ||
        message.includes("invalid_action")) {
      return respond({ ok: false, error: { code: "invalid_note", message: "Проверь текст заметки и выбранное действие." } }, 400);
    }
    console.error("save_note: database operation failed", error.code);
    return respond({ ok: false, error: { code: "save_note_failed", message: "Не удалось сохранить заметку." } }, 500);
  }

  return respond({ ok: true, operation: "save_note", note: data });
});

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return handler(req);
});
