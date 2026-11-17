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
    free_explanation?: unknown;
    answers?: unknown;
  };

  try {
    body = await req.json();
  } catch {
    return respond({ ok: false, error: { code: "invalid_json", message: "Тело запроса должно быть JSON." } }, 400);
  }

  if (!isUuid(body?.investigation_id) || !isUuid(body?.report_id) || !isUuid(body?.request_id)) {
    return respond({ ok: false, error: { code: "invalid_ids", message: "Проверь ID расследования, заключения и запроса." } }, 400);
  }

  if (body.free_explanation !== undefined && body.free_explanation !== null &&
      (typeof body.free_explanation !== "string" || body.free_explanation.length > 20000)) {
    return respond({ ok: false, error: { code: "invalid_explanation", message: "Пояснение не должно превышать 20000 символов." } }, 400);
  }

  if (body.answers === null || typeof body.answers !== "object" || Array.isArray(body.answers)) {
    return respond({ ok: false, error: { code: "invalid_answers", message: "Ответы должны быть объектом с кодами вопросов." } }, 400);
  }

  const entries = Object.entries(body.answers as Record<string, unknown>);
  if (entries.length > 100 || entries.some(([key]) => key.trim().length === 0 || key.length > 80)) {
    return respond({ ok: false, error: { code: "invalid_answers", message: "Проверь коды вопросов и количество ответов." } }, 400);
  }

  const userId = ctx.userClaims?.id;
  if (!userId) {
    return respond({ ok: false, error: { code: "unauthorized", message: "Требуется вход в аккаунт." } }, 401);
  }

  // Preflight scope check: never let a report ID from another investigation reach the
  // idempotency lookup in the privileged database operation.
  const { data: matchingReport, error: reportLookupError } = await ctx.supabaseAdmin
    .schema("game")
    .from("player_final_reports")
    .select("id")
    .eq("id", body.report_id)
    .eq("investigation_id", body.investigation_id)
    .maybeSingle();

  if (reportLookupError) {
    console.error("save_final_report_revision: report scope check failed", reportLookupError.code);
    return respond({ ok: false, error: { code: "report_scope_check_failed", message: "Не удалось проверить заключение." } }, 500);
  }

  if (!matchingReport) {
    const { data: reportWithId, error: globalLookupError } = await ctx.supabaseAdmin
      .schema("game")
      .from("player_final_reports")
      .select("id")
      .eq("id", body.report_id)
      .maybeSingle();

    if (globalLookupError) {
      console.error("save_final_report_revision: report existence check failed", globalLookupError.code);
      return respond({ ok: false, error: { code: "report_scope_check_failed", message: "Не удалось проверить заключение." } }, 500);
    }
    if (reportWithId) {
      return respond({ ok: false, error: { code: "not_found_or_unavailable", message: "Заключение недоступно." } }, 404);
    }
  }

  const { data, error } = await ctx.supabaseAdmin
    .schema("game")
    .rpc("save_final_report_revision", {
      p_investigation_id: body.investigation_id,
      p_report_id: body.report_id,
      p_user_id: userId,
      p_request_id: body.request_id,
      p_free_explanation: typeof body.free_explanation === "string" ? body.free_explanation : null,
      p_answers: body.answers,
    });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("investigation_not_available")) {
      return respond({ ok: false, error: { code: "not_found_or_unavailable", message: "Расследование недоступно." } }, 404);
    }
    if (message.includes("report_not_editable")) {
      return respond({ ok: false, error: { code: "report_not_editable", message: "Отправленное заключение уже нельзя изменить." } }, 409);
    }
    if (message.includes("unknown_report_question")) {
      return respond({ ok: false, error: { code: "unknown_report_question", message: "В заключении есть ответ на неизвестный вопрос." } }, 400);
    }
    if (message.includes("report_answer_type_invalid")) {
      return respond({ ok: false, error: { code: "report_answer_type_invalid", message: "Ответ не соответствует типу вопроса или выбранному варианту." } }, 400);
    }
    if (message.includes("answers_must_be_object") || message.includes("explanation_too_long") ||
        message.includes("too_many_answers") || message.includes("invalid_question_code")) {
      return respond({ ok: false, error: { code: "invalid_report", message: "Проверь ответы и текст заключения." } }, 400);
    }
    console.error("save_final_report_revision: database operation failed", error.code);
    return respond({ ok: false, error: { code: "save_final_report_failed", message: "Не удалось сохранить заключение." } }, 500);
  }

  return respond({ ok: true, operation: "save_final_report_revision", report: data });
});

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return handler(req);
});
