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

  let body: { investigation_id?: unknown; material_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return respond({ ok: false, error: { code: "invalid_json", message: "Тело запроса должно быть JSON." } }, 400);
  }

  if (!isUuid(body?.investigation_id)) {
    return respond({ ok: false, error: { code: "invalid_investigation_id", message: "Укажи корректный investigation_id." } }, 400);
  }
  if (!isUuid(body?.material_id)) {
    return respond({ ok: false, error: { code: "invalid_material_id", message: "Укажи корректный material_id." } }, 400);
  }

  const userId = ctx.userClaims?.id;
  if (!userId) {
    return respond({ ok: false, error: { code: "unauthorized", message: "Требуется вход в аккаунт." } }, 401);
  }

  const { data, error } = await ctx.supabaseAdmin
    .schema("game")
    .rpc("open_material_atomic", {
      p_investigation_id: body.investigation_id,
      p_material_id: body.material_id,
      p_user_id: userId,
    });

  if (error) {
    const message = error.message ?? "";
    if (message.includes("material_locked")) {
      return respond({ ok: false, error: { code: "material_locked", message: "Этот материал пока недоступен." } }, 409);
    }
    if (message.includes("investigation_not_found") ||
        message.includes("material_not_found")) {
      return respond({ ok: false, error: { code: "not_found", message: "Материал или расследование не найдены." } }, 404);
    }
    if (message.includes("investigation_not_active")) {
      return respond({ ok: false, error: { code: "investigation_not_active", message: "Это расследование уже нельзя продолжить." } }, 409);
    }
    console.error("open_material: database operation failed", error.code);
    return respond({ ok: false, error: { code: "open_material_failed", message: "Не удалось открыть материал." } }, 500);
  }

  return respond({
    ok: true,
    operation: "open_material",
    material: data,
  });
});

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return handler(req);
});
