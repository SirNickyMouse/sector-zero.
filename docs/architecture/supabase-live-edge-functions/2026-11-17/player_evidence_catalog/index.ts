import { withSupabase } from "npm:@supabase/server@1";
const corsHeaders={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS"};
function json(data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders,"Content-Type":"application/json"}});}
function isUuid(v:unknown):v is string{return typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);}
const handler=withSupabase({auth:"user"},async(req,ctx)=>{
 if(req.method!=="POST")return json({ok:false,error:{code:"method_not_allowed"}},405);
 let body:any;try{body=await req.json()}catch{return json({ok:false,error:{code:"invalid_json"}},400);}
 if(!isUuid(body?.investigation_id))return json({ok:false,error:{code:"invalid_investigation_id"}},400);
 const userId=ctx.userClaims?.id;if(!userId)return json({ok:false,error:{code:"unauthorized"}},401);
 const db=ctx.supabaseAdmin;
 const {data:i,error:ie}=await db.schema("game").from("investigations").select("id,case_version_id,owner_user_id,status").eq("id",body.investigation_id).maybeSingle();
 if(ie||!i)return json({ok:false,error:{code:"not_found"}},404);
 let access=i.owner_user_id===userId;
 if(!access){const {data:m}=await db.schema("game").from("investigation_members").select("user_id").eq("investigation_id",i.id).eq("user_id",userId).maybeSingle();access=!!m;}
 if(!access)return json({ok:false,error:{code:"not_found"}},404);
 if(i.status!=="active")return json({ok:false,error:{code:"investigation_not_active"}},409);
 const {data:opened,error:oe}=await db.schema("game").from("player_materials").select("material_id").eq("investigation_id",i.id);
 if(oe)return json({ok:false,error:{code:"evidence_read_failed"}},500);
 const ids=(opened??[]).map((x:any)=>x.material_id);
 if(!ids.length)return json({ok:true,evidence:[]});
 const {data:links,error:le}=await db.schema("game").from("material_evidence").select("material_id,evidence_id,context_note").eq("case_version_id",i.case_version_id).in("material_id",ids);
 if(le){console.error("player_evidence_catalog: links",le.code);return json({ok:false,error:{code:"evidence_read_failed"}},500);}
 const eids=[...new Set((links??[]).map((x:any)=>x.evidence_id))];
 if(!eids.length)return json({ok:true,evidence:[]});
 const [{data:evidence,error:ee},{data:materials,error:me}]=await Promise.all([
  db.schema("game").from("evidence").select("id,code,title,public_description,evidence_type").eq("case_version_id",i.case_version_id).in("id",eids),
  db.schema("game").from("materials").select("id,title,code").eq("case_version_id",i.case_version_id).in("id",ids)
 ]);
 if(ee||me){console.error("player_evidence_catalog: evidence",ee?.code,me?.code);return json({ok:false,error:{code:"evidence_read_failed"}},500);}
 return json({ok:true,evidence:(evidence??[]).map((e:any)=>({...e,found_in:(links??[]).filter((l:any)=>l.evidence_id===e.id).map((l:any)=>({material_id:l.material_id,material_title:(materials??[]).find((m:any)=>m.id===l.material_id)?.title||null,context_note:l.context_note}))}))});
});
Deno.serve((req:Request)=>req.method==="OPTIONS"?new Response("ok",{headers:corsHeaders}):handler(req));