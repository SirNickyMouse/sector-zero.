import { withSupabase } from "npm:@supabase/server@1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const operations: Record<string, "editor" | "owner"> = {
  create_season_draft: "editor",
  create_case_draft: "editor",
  save_character: "editor",
  save_material: "editor",
  save_evidence: "editor",
  attach_evidence_to_material: "editor",
  save_claim: "editor",
  save_truth_event: "editor",
  save_truth_relationship: "editor",
  save_truth_explanation: "editor",
  save_puzzle: "editor",
  save_puzzle_answer: "editor",
  save_puzzle_hint: "editor",
  save_unlock_rule: "editor",
  validate_case_version_for_publish: "editor",
  validate_final_report_contract: "editor",
  validate_solution_rubric: "editor",
  publish_case_version: "owner",
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

  const input = body as Record<string, unknown>;
  const operation = input.operation;
  const args = input.args;

  if (typeof operation !== "string" || !Object.hasOwn(operations, operation)) {
    return new Response(JSON.stringify({ error: "operation_not_allowed" }), {
      status: 400, headers: corsHeaders,
    });
  }
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return new Response(JSON.stringify({ error: "invalid_args" }), {
      status: 400, headers: corsHeaders,
    });
  }

  const { data: access, error: accessError } = await ctx.supabaseAdmin
    .schema("author")
    .rpc("get_author_access", { p_user_id: userId });

  if (accessError || !access) {
    return new Response(JSON.stringify({ error: "access_check_failed" }), {
      status: 500, headers: corsHeaders,
    });
  }
  if (access.is_author !== true) {
    return new Response(JSON.stringify({ error: "author_access_required" }), {
      status: 403, headers: corsHeaders,
    });
  }
  if (operations[operation] === "owner" && access.role !== "owner") {
    return new Response(JSON.stringify({ error: "owner_access_required" }), {
      status: 403, headers: corsHeaders,
    });
  }

  const { data, error } = await ctx.supabaseAdmin
    .schema("author")
    .rpc(operation, args as Record<string, unknown>);

  if (error) {
    return new Response(JSON.stringify({
      error: "author_operation_failed",
      code: error.code ?? null,
    }), { status: 400, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ ok: true, result: data }), {
    status: 200, headers: corsHeaders,
  });
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
