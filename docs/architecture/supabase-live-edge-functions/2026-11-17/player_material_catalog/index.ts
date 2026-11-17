import { withSupabase } from "npm:@supabase/server@1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});}
function isUuid(v:unknown):v is string{return typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);}
const handler=withSupabase({auth:"user"},async(req,ctx)=>{
  if(req.method!=="POST")return json({ok:false,error:{code:"method_not_allowed"}},405);
  let body:any;try{body=await req.json()}catch{return json({ok:false,error:{code:"invalid_json"}},400)}
  if(!isUuid(body?.investigation_id))return json({ok:false,error:{code:"invalid_investigation_id"}},400);
  const userId=ctx.userClaims?.id;if(!userId)return json({ok:false,error:{code:"unauthorized"}},401);
  const db=ctx.supabaseAdmin;
  const {data:i,error:ie}=await db.schema("game").from("investigations")
    .select("id,case_version_id,owner_user_id,status").eq("id",body.investigation_id).maybeSingle();
  if(ie||!i)return json({ok:false,error:{code:"not_found",message:"Расследование не найдено."}},404);
  let access=i.owner_user_id===userId;
  if(!access){const {data:m}=await db.schema("game").from("investigation_members").select("user_id")
    .eq("investigation_id",i.id).eq("user_id",userId).maybeSingle();access=!!m;}
  if(!access)return json({ok:false,error:{code:"not_found",message:"Расследование не найдено."}},404);
  if(i.status!=="active")return json({ok:false,error:{code:"investigation_not_active"}},409);
  const {data:v}=await db.schema("game").from("case_versions").select("id,case_id,status").eq("id",i.case_version_id).maybeSingle();
  const {data:c}=v?await db.schema("game").from("cases").select("id,season_id,status").eq("id",v.case_id).maybeSingle():{data:null};
  const {data:s}=c?await db.schema("game").from("seasons").select("id,status").eq("id",c.season_id).maybeSingle():{data:null};
  if(!v||!c||!s||v.status!=="published"||c.status!=="published"||s.status!=="published")
    return json({ok:false,error:{code:"case_unavailable"}},409);
  const [{data:materials,error:me},{data:opened,error:oe},{data:rules,error:re}]=await Promise.all([
    db.schema("game").from("materials").select("id,code,title,material_type,sort_order,is_initially_available").eq("case_version_id",i.case_version_id).order("sort_order"),
    db.schema("game").from("player_materials").select("material_id").eq("investigation_id",i.id),
    db.schema("game").from("unlock_rules").select("target_id,rule_expression,is_mandatory,target_type").eq("case_version_id",i.case_version_id).eq("target_type","material")
  ]);
  if(me||oe||re){console.error("player_material_catalog: query failed",me?.code,oe?.code,re?.code);return json({ok:false,error:{code:"catalog_failed"}},500);}
  const openedSet=new Set((opened??[]).map((x:any)=>x.material_id));
  const output=[];
  for(const m of materials??[]){
    const rs=(rules??[]).filter((r:any)=>r.target_id===m.id);
    let available=!!m.is_initially_available||openedSet.has(m.id);
    if(!available&&rs.length){
      const evaluated=await Promise.all(rs.map(async(r:any)=>{
        const {data,error}=await db.schema("game").rpc("evaluate_unlock_expression",{p_investigation_id:i.id,p_expression:r.rule_expression});
        if(error)throw error;
        return {mandatory:!!r.is_mandatory,passed:data===true};
      }));
      const mandatory=evaluated.filter(x=>x.mandatory),optional=evaluated.filter(x=>!x.mandatory);
      available=(mandatory.length===0||mandatory.every(x=>x.passed))&&
        (optional.length===0||optional.some(x=>x.passed))&&evaluated.length>0;
    }
    const visible = openedSet.has(m.id) || available;
    output.push({
      id: visible ? m.id : null,
      code: visible ? m.code : null,
      title: visible ? m.title : "Закрытый материал",
      material_type: visible ? m.material_type : null,
      sort_order: m.sort_order,
      is_opened: openedSet.has(m.id),
      is_available: available
    });
  }
  return json({ok:true,materials:output});
});
Deno.serve((req:Request)=>req.method==="OPTIONS"?new Response("ok",{headers:corsHeaders}):handler(req));
