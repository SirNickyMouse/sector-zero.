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
    return respond({ ok: false, error: { code: "method_not_allowed" } }, 405);
  }

  let body: { case_version_id?: unknown; request_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return respond({ ok: false, error: { code: "invalid_json", message: "Тело запроса должно быть JSON." } }, 400);
  }

  if (!isUuid(body?.case_version_id)) {
    return respond({ ok: false, error: { code: "invalid_case_version_id", message: "Укажи корректный case_version_id." } }, 400);
  }
  if (!isUuid(body?.request_id)) {
    return respond({ ok: false, error: { code: "invalid_request_id", message: "Укажи UUID запроса для защиты от повторного создания." } }, 400);
  }

  const userId = ctx.userClaims?.id;
  if (!userId) {
    return respond({ ok: false, error: { code: "unauthorized", message: "Требуется вход в аккаунт." } }, 401);
  }

  const { data, error } = await ctx.supabaseAdmin
    .schema("game")
    .rpc("start_investigation_atomic", {
      p_case_version_id: body.case_version_id,
      p_user_id: userId,
      p_request_id: body.request_id,
    });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("case_version_unavailable") ||
        message.includes("case_unavailable") ||
        message.includes("season_unavailable")) {
      return respond({ ok: false, error: { code: "case_unavailable", message: "Это дело пока недоступно для начала." } }, 409);
    }
    if (message.includes("user_unavailable")) {
      return respond({ ok: false, error: { code: "user_unavailable", message: "Пользовательская сессия недействительна." } }, 401);
    }
    console.error("start_investigation: database operation failed", error.code);
    return respond({ ok: false, error: { code: "start_failed", message: "Не удалось начать расследование." } }, 500);
  }

  return respond({
    ok: true,
    operation: "start_investigation",
    ...data,
  }, data?.already_created ? 200 : 201);
});

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return handler(req);
});
