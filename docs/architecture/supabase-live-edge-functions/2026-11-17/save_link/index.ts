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

const allowedNodeTypes = ["material", "evidence", "character", "claim", "note"];
const allowedLinkTypes = ["supports", "contradicts", "mentions", "related_to", "depends_on", "excludes"];

const handler = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") {
    return respond({ ok: false, error: { code: "method_not_allowed", message: "Используй POST." } }, 405);
  }

  let body: {
    investigation_id?: unknown;
    link_id?: unknown;
    request_id?: unknown;
    action?: unknown;
    source_type?: unknown;
    source_id?: unknown;
    target_type?: unknown;
    target_id?: unknown;
    link_type?: unknown;
    explanation?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return respond({ ok: false, error: { code: "invalid_json", message: "Тело запроса должно быть JSON." } }, 400);
  }

  if (!isUuid(body?.investigation_id) || !isUuid(body?.link_id) || !isUuid(body?.request_id)) {
    return respond({ ok: false, error: { code: "invalid_ids", message: "Проверь ID расследования, связи и запроса." } }, 400);
  }

  const action = body.action;
  if (action !== "save" && action !== "delete" && action !== "restore") {
    return respond({ ok: false, error: { code: "invalid_action", message: "Допустимые действия: save, delete, restore." } }, 400);
  }

  if (action === "save") {
    if (!allowedNodeTypes.includes(String(body.source_type)) ||
        !allowedNodeTypes.includes(String(body.target_type)) ||
        !isUuid(body.source_id) || !isUuid(body.target_id) ||
        !allowedLinkTypes.includes(String(body.link_type))) {
      return respond({ ok: false, error: { code: "invalid_link", message: "Проверь типы и идентификаторы объектов связи." } }, 400);
    }
    if (body.explanation !== undefined && body.explanation !== null &&
        (typeof body.explanation !== "string" || body.explanation.length > 3000)) {
      return respond({ ok: false, error: { code: "invalid_explanation", message: "Пояснение не должно превышать 3000 символов." } }, 400);
    }
  }

  const userId = ctx.userClaims?.id;
  if (!userId) {
    return respond({ ok: false, error: { code: "unauthorized", message: "Требуется вход в аккаунт." } }, 401);
  }

  const { data, error } = await ctx.supabaseAdmin
    .schema("game")
    .rpc("save_link_atomic", {
      p_investigation_id: body.investigation_id,
      p_link_id: body.link_id,
      p_user_id: userId,
      p_request_id: body.request_id,
      p_action: action,
      p_source_type: typeof body.source_type === "string" ? body.source_type : null,
      p_source_id: isUuid(body.source_id) ? body.source_id : null,
      p_target_type: typeof body.target_type === "string" ? body.target_type : null,
      p_target_id: isUuid(body.target_id) ? body.target_id : null,
      p_link_type: typeof body.link_type === "string" ? body.link_type : null,
      p_explanation: typeof body.explanation === "string" ? body.explanation : null,
    });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("investigation_not_available") ||
        message.includes("link_not_available") ||
        message.includes("link_endpoint_unavailable")) {
      return respond({ ok: false, error: { code: "not_found_or_unavailable", message: "Расследование или один из объектов связи недоступен." } }, 404);
    }
    if (message.includes("invalid_link_data") || message.includes("self_link_not_allowed") ||
        message.includes("explanation_too_long") || message.includes("invalid_action")) {
      return respond({ ok: false, error: { code: "invalid_link", message: "Проверь параметры связи." } }, 400);
    }
    console.error("save_link: database operation failed", error.code);
    return respond({ ok: false, error: { code: "save_link_failed", message: "Не удалось сохранить связь." } }, 500);
  }

  return respond({ ok: true, operation: "save_link", link: data });
});

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return handler(req);
});
