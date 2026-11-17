import { withSupabase } from "npm:@supabase/server@1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const handler = withSupabase({ auth: "user" }, async (_req, ctx) => {
  const userId = ctx.userClaims?.sub ?? ctx.userClaims?.id;
  if (typeof userId !== "string") {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: corsHeaders,
    });
  }

  const { data: access, error: accessError } = await ctx.supabaseAdmin
    .schema("author")
    .rpc("get_author_access", { p_user_id: userId });

  if (accessError || !access) {
    console.error("author_dashboard access lookup failed", accessError?.code ?? "no_data");
    return new Response(JSON.stringify({ error: "access_check_failed" }), {
      status: 500, headers: corsHeaders,
    });
  }
  if (access.is_author !== true) {
    return new Response(JSON.stringify({ error: "author_access_required" }), {
      status: 403, headers: corsHeaders,
    });
  }

  const { data: dashboard, error: dashboardError } = await ctx.supabaseAdmin
    .schema("author")
    .rpc("get_author_dashboard");

  if (dashboardError || !dashboard) {
    console.error("author_dashboard data lookup failed", dashboardError?.code ?? "no_data");
    return new Response(JSON.stringify({ error: "dashboard_load_failed" }), {
      status: 500, headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({
    role: access.role,
    seasons: dashboard.seasons ?? [],
    cases: dashboard.cases ?? [],
  }), { status: 200, headers: corsHeaders });
});

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405, headers: corsHeaders,
    });
  }
  return handler(req);
});
