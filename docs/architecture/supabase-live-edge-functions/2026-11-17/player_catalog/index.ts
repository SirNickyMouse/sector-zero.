import { withSupabase } from "npm:@supabase/server@1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
const handler = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") return json({ ok:false, error:{code:"method_not_allowed"} },405);
  const userId = ctx.userClaims?.id;
  if (!userId) return json({ ok:false, error:{code:"unauthorized"} },401);
  const db = ctx.supabaseAdmin;
  const { data: seasons, error: seasonError } = await db.schema("game").from("seasons")
    .select("id, code, title, description, season_number")
    .eq("status","published").order("season_number",{ascending:true});
  if (seasonError) {
    console.error("player_catalog: seasons", seasonError.code);
    return json({ok:false,error:{code:"catalog_failed",message:"Не удалось загрузить список дел."}},500);
  }
  const seasonIds = (seasons ?? []).map((s:any)=>s.id);
  let cases:any[] = [];
  if (seasonIds.length) {
    const {data,error} = await db.schema("game").from("cases")
      .select("id, season_id, code, title, short_description, sort_order")
      .in("season_id",seasonIds).eq("status","published").order("sort_order");
    if (error) {
      console.error("player_catalog: cases",error.code);
      return json({ok:false,error:{code:"catalog_failed",message:"Не удалось загрузить список дел."}},500);
    }
    cases = data ?? [];
  }
  const caseIds = cases.map((c:any)=>c.id);
  let versions:any[] = [];
  if (caseIds.length) {
    const {data,error} = await db.schema("game").from("case_versions")
      .select("id, case_id, version_number")
      .in("case_id",caseIds).eq("status","published").order("version_number",{ascending:false});
    if (error) {
      console.error("player_catalog: versions",error.code);
      return json({ok:false,error:{code:"catalog_failed",message:"Не удалось загрузить версии дел."}},500);
    }
    versions = data ?? [];
  }
  const {data: investigations,error: invError} = await db.schema("game").from("investigations")
    .select("id, case_version_id, title, status, started_at, updated_at")
    .eq("owner_user_id",userId).eq("status","active").order("updated_at",{ascending:false}).limit(50);
  if (invError) {
    console.error("player_catalog: investigations",invError.code);
    return json({ok:false,error:{code:"catalog_failed",message:"Не удалось загрузить ваши расследования."}},500);
  }
  return json({
    ok:true,
    seasons: (seasons ?? []).map((s:any)=>({
      ...s,
      cases: cases.filter((c:any)=>c.season_id===s.id).map((c:any)=>({
        ...c,
        versions: versions.filter((v:any)=>v.case_id===c.id)
      }))
    })),
    investigations: investigations ?? []
  });
});
Deno.serve((req:Request)=>req.method==="OPTIONS"
  ? new Response("ok",{headers:corsHeaders})
  : handler(req));
