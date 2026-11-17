import { withSupabase } from "npm:@supabase/server@1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
const handler = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") return respond({ ok: false, error: { code: "method_not_allowed", message: "Используй POST." } }, 405);
  let body: { investigation_id?: unknown; report_id?: unknown; request_id?: unknown };
  try { body = await req.json(); } catch {
    return respond({ ok: false, error: { code: "invalid_json", message: "Тело запроса должно быть JSON." } }, 400);
  }
  if (!isUuid(body?.investigation_id) || !isUuid(body?.report_id) || !isUuid(body?.request_id)) {
    return respond({ ok: false, error: { code: "invalid_ids", message: "Проверь ID расследования, заключения и запроса." } }, 400);
  }
  const userId = ctx.userClaims?.id;
  if (!userId) return respond({ ok: false, error: { code: "unauthorized", message: "Требуется вход в аккаунт." } }, 401);

  const { data: matchingReport, error: reportLookupError } = await ctx.supabaseAdmin
    .schema("game").from("player_final_reports").select("id")
    .eq("id", body.report_id).eq("investigation_id", body.investigation_id).maybeSingle();
  if (reportLookupError) {
    console.error("evaluate_final_report: report scope check failed", reportLookupError.code);
    return respond({ ok: false, error: { code: "report_scope_check_failed", message: "Не удалось проверить заключение." } }, 500);
  }
  if (!matchingReport) return respond({ ok: false, error: { code: "not_found_or_unavailable", message: "Заключение недоступно." } }, 404);

  const { data, error } = await ctx.supabaseAdmin.schema("game").rpc("evaluate_final_report_atomic", {
    p_investigation_id: body.investigation_id, p_report_id: body.report_id,
    p_user_id: userId, p_request_id: body.request_id,
  });
  if (error) {
    const message = error.message ?? "";
    if (message.includes("investigation_not_available") || message.includes("report_not_found"))
      return respond({ ok: false, error: { code: "not_found_or_unavailable", message: "Расследование или заключение недоступно." } }, 404);
    if (message.includes("report_not_submitted"))
      return respond({ ok: false, error: { code: "report_not_submitted", message: "Сначала отправь окончательное заключение." } }, 409);
    if (message.includes("evaluation_rubric_unavailable"))
      return respond({ ok: false, error: { code: "evaluation_not_configured", message: "Для этого дела ещё не настроены критерии оценки." } }, 409);
    if (message.includes("submitted_revision_unavailable"))
      return respond({ ok: false, error: { code: "submitted_revision_unavailable", message: "Не удалось проверить отправленную редакцию заключения." } }, 409);
    if (message.includes("invalid_evaluation_config") || message.includes("invalid_expected_values") ||
        message.includes("invalid_required_evidence") || message.includes("invalid_required_claims") ||
        message.includes("invalid_required_reasoning") || message.includes("invalid_required_links") ||
        message.includes("criterion_has_no_scoring_rules")) {
      console.error("evaluate_final_report: invalid author rubric", error.code);
      return respond({ ok: false, error: { code: "evaluation_configuration_error", message: "В критериях этого дела обнаружена ошибка настройки." } }, 500);
    }
    console.error("evaluate_final_report: database operation failed", error.code);
    return respond({ ok: false, error: { code: "evaluation_failed", message: "Не удалось оценить заключение." } }, 500);
  }
  return respond({ ok: true, operation: "evaluate_final_report", evaluation: data });
});
Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return handler(req);
});
