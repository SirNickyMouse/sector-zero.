import { withSupabase } from "npm:@supabase/server@1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const handler = withSupabase({ auth: "user" }, async (req, ctx) => {
  const userId = ctx.userClaims?.sub ?? ctx.userClaims?.id;
  if (typeof userId !== "string") {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401, headers: corsHeaders,
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_json" }), {
      status: 400, headers: corsHeaders,
    });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return new Response(JSON.stringify({ error: "invalid_request" }), {
      status: 400, headers: corsHeaders,
    });
  }

  const caseVersionId = (body as Record<string, unknown>).case_version_id;
  if (typeof caseVersionId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(caseVersionId)) {
    return new Response(JSON.stringify({ error: "invalid_case_version_id" }), {
      status: 400, headers: corsHeaders,
    });
  }

  const { data: access, error: accessError } = await ctx.supabaseAdmin
    .schema("author")
    .rpc("get_author_access", { p_user_id: userId });

  if (accessError || !access) {
    console.error("author_case_workspace access lookup failed", accessError?.code ?? "no_data");
    return new Response(JSON.stringify({ error: "access_check_failed" }), {
      status: 500, headers: corsHeaders,
    });
  }
  if (access.is_author !== true) {
    return new Response(JSON.stringify({ error: "author_access_required" }), {
      status: 403, headers: corsHeaders,
    });
  }

  const { data: workspace, error: workspaceError } = await ctx.supabaseAdmin
    .schema("author")
    .rpc("get_case_workspace", { p_case_version_id: caseVersionId });

  if (workspaceError) {
    console.error("author_case_workspace load failed", workspaceError.code ?? "unknown");
    return new Response(JSON.stringify({ error: "case_workspace_load_failed" }), {
      status: 500, headers: corsHeaders,
    });
  }
  if (!workspace) {
    return new Response(JSON.stringify({ error: "draft_case_version_not_found" }), {
      status: 404, headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({
    role: access.role,
    workspace,
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
