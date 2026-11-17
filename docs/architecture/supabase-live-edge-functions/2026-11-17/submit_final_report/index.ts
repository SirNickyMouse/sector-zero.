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
    report_id?: unknown;
    request_id?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return respond({ ok: false, error: { code: "invalid_json", message: "Тело запроса должно быть JSON." } }, 400);
  }

  if (!isUuid(body?.investigation_id) || !isUuid(body?.report_id) || !isUuid(body?.request_id)) {
    return respond({ ok: false, error: { code: "invalid_ids", message: "Проверь ID расследования, заключения и запроса." } }, 400);
  }

  const userId = ctx.userClaims?.id;
  if (!userId) {
    return respond({ ok: false, error: { code: "unauthorized", message: "Требуется вход в аккаунт." } }, 401);
  }

  const { data, error } = await ctx.supabaseAdmin
    .schema("game")
    .rpc("submit_final_report", {
      p_investigation_id: body.investigation_id,
      p_report_id: body.report_id,
      p_user_id: userId,
      p_request_id: body.request_id,
    });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("investigation_not_available") || message.includes("report_not_available")) {
      return respond({ ok: false, error: { code: "not_found_or_unavailable", message: "Расследование или заключение недоступны." } }, 404);
    }
    if (message.includes("report_already_submitted")) {
      return respond({ ok: false, error: { code: "report_already_submitted", message: "Заключение уже отправлено и больше не редактируется." } }, 409);
    }
    if (message.includes("submission_request_id_already_used")) {
      return respond({ ok: false, error: { code: "request_id_already_used", message: "Этот ID запроса уже использован. Создай новый ID для отправки." } }, 409);
    }
    if (message.includes("investigation_stages_incomplete")) {
      return respond({ ok: false, error: { code: "stages_incomplete", message: "Сначала заверши все обязательные этапы расследования." } }, 409);
    }
    if (message.includes("investigation_final_stage_locked")) {
      return respond({ ok: false, error: { code: "final_stage_locked", message: "Итоговое заключение пока закрыто. Продолжи расследование." } }, 409);
    }
    if (message.includes("required_report_questions_missing")) {
      return respond({ ok: false, error: { code: "required_report_questions_missing", message: "Ответь на все обязательные вопросы перед отправкой заключения." } }, 409);
    }
    if (message.includes("investigation_not_submittable") || message.includes("report_not_submittable") ||
        message.includes("report_has_no_saved_revision")) {
      return respond({ ok: false, error: { code: "report_not_ready", message: "Сначала сохрани черновик заключения." } }, 409);
    }
    console.error("submit_final_report: database operation failed", error.code);
    return respond({ ok: false, error: { code: "submit_final_report_failed", message: "Не удалось отправить заключение." } }, 500);
  }

  return respond({ ok: true, operation: "submit_final_report", report: data });
});

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return handler(req);
});
