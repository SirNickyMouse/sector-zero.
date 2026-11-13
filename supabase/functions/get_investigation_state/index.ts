import { withSupabase } from "npm:@supabase/server@1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function fail(code: string, status: number, message: string) {
  return json({ ok: false, error: { code, message } }, status);
}

const handler = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") return fail("method_not_allowed", 405, "Используй POST.");

  let body: { investigation_id?: unknown };
  try {
    body = await req.json();
  } catch {
    return fail("invalid_json", 400, "Тело запроса должно быть JSON.");
  }

  const investigationId = body?.investigation_id;
  if (!isUuid(investigationId)) {
    return fail("invalid_investigation_id", 400, "Не указан корректный investigation_id.");
  }

  const userId = ctx.userClaims?.id;
  if (!userId) return fail("unauthorized", 401, "Требуется вход в аккаунт.");

  // Privileged client is used only after the caller's identity is verified.
  // Every player-owned query below is explicitly scoped to this investigation.
  const db = ctx.supabaseAdmin;

  const { data: investigation, error: investigationError } = await db
    .schema("game")
    .from("investigations")
    .select("id, case_version_id, owner_user_id, title, status, started_at, updated_at")
    .eq("id", investigationId)
    .maybeSingle();

  if (investigationError) {
    console.error("get_investigation_state: investigation lookup failed", investigationError.code);
    return fail("state_read_failed", 500, "Не удалось загрузить расследование.");
  }
  if (!investigation) return fail("investigation_not_found", 404, "Расследование не найдено.");

  let hasAccess = investigation.owner_user_id === userId;
  if (!hasAccess) {
    const { data: membership, error: membershipError } = await db
      .schema("game")
      .from("investigation_members")
      .select("investigation_id, user_id, member_role, joined_at")
      .eq("investigation_id", investigationId)
      .eq("user_id", userId)
      .maybeSingle();

    if (membershipError) {
      console.error("get_investigation_state: membership lookup failed", membershipError.code);
      return fail("state_read_failed", 500, "Не удалось проверить доступ к расследованию.");
    }
    hasAccess = !!membership;
  }
  // Use 404 rather than 403 to avoid confirming another player's investigation ID.
  if (!hasAccess) return fail("investigation_not_found", 404, "Расследование не найдено.");

  const { data: version, error: versionError } = await db
    .schema("game")
    .from("case_versions")
    .select("id, case_id, version_number, status")
    .eq("id", investigation.case_version_id)
    .maybeSingle();

  if (versionError || !version) {
    console.error("get_investigation_state: version lookup failed", versionError?.code);
    return fail("case_version_unavailable", 409, "Версия дела сейчас недоступна.");
  }

  const { data: caseRow, error: caseError } = await db
    .schema("game")
    .from("cases")
    .select("id, season_id, code, title, short_description, status")
    .eq("id", version.case_id)
    .maybeSingle();

  if (caseError || !caseRow) {
    console.error("get_investigation_state: case lookup failed", caseError?.code);
    return fail("case_unavailable", 409, "Дело сейчас недоступно.");
  }

  const { data: season, error: seasonError } = await db
    .schema("game")
    .from("seasons")
    .select("id, code, title, season_number, status")
    .eq("id", caseRow.season_id)
    .maybeSingle();

  if (seasonError || !season ||
      version.status !== "published" ||
      caseRow.status !== "published" ||
      season.status !== "published") {
    return fail("case_unavailable", 409, "Дело сейчас недоступно.");
  }

  const [
    materialsState, puzzlesState, notes, noteRevisions, links, linkRevisions, hypotheses, suspects,
    reports, events, summary, characters
  ] = await Promise.all([
    db.schema("game").from("player_materials")
      .select("material_id, case_version_id, opened_at, first_viewed_at, last_viewed_at, view_count")
      .eq("investigation_id", investigationId).order("opened_at", { ascending: true }),
    db.schema("game").from("player_puzzles")
      .select("puzzle_id, case_version_id, status, submitted_answer, solved_at, hints_used, attempts_count, updated_at")
      .eq("investigation_id", investigationId).order("updated_at", { ascending: true }),
    db.schema("game").from("player_notes")
      .select("id, title, body, related_material_id, case_version_id, created_at, updated_at")
      .eq("investigation_id", investigationId).eq("author_user_id", userId)
      .is("deleted_at", null).order("updated_at", { ascending: false }).limit(300),
    db.schema("game").from("player_note_revisions")
      .select("id, note_id, revision_number, action, title, body, related_material_id, deleted_at, created_at")
      .eq("investigation_id", investigationId).eq("actor_user_id", userId)
      .order("revision_number", { ascending: true }).limit(1000),
    db.schema("game").from("player_links")
      .select("id, source_type, source_id, target_type, target_id, link_type, explanation, created_at, updated_at")
      .eq("investigation_id", investigationId).eq("author_user_id", userId)
      .is("deleted_at", null).order("created_at", { ascending: true }).limit(500),
    db.schema("game").from("player_link_revisions")
      .select("id, link_id, revision_number, action, source_type, source_id, target_type, target_id, link_type, explanation, deleted_at, created_at")
      .eq("investigation_id", investigationId).eq("actor_user_id", userId)
      .order("revision_number", { ascending: true }).limit(1500),
    db.schema("game").from("player_hypotheses")
      .select("id, title, current_text, status, current_revision_number, created_at, updated_at")
      .eq("investigation_id", investigationId).eq("author_user_id", userId)
      .order("created_at", { ascending: true }).limit(200),
    db.schema("game").from("player_suspects")
      .select("character_id, case_version_id, player_status, player_notes, updated_at")
      .eq("investigation_id", investigationId),
    db.schema("game").from("player_final_reports")
      .select("id, status, free_explanation, submitted_at, submitted_revision_id, evaluated_at, score, evaluation_summary, created_at, updated_at")
      .eq("investigation_id", investigationId).order("created_at", { ascending: true }).limit(50),
    db.schema("game").from("investigation_events")
      .select("id, actor_user_id, event_type, entity_type, entity_id, created_at")
      .eq("investigation_id", investigationId).order("created_at", { ascending: false }).limit(200),
    db.schema("game").from("investigation_summary")
      .select("*").eq("investigation_id", investigationId).maybeSingle(),
    db.schema("game").from("characters")
      .select("id, code, name, public_role, public_description")
      .eq("case_version_id", investigation.case_version_id).order("name", { ascending: true }),
  ]);

  const queryErrors = [
    materialsState.error, puzzlesState.error, notes.error, noteRevisions.error, links.error, linkRevisions.error,
    hypotheses.error, suspects.error, reports.error, events.error,
    summary.error, characters.error
  ].filter(Boolean);

  if (queryErrors.length) {
    console.error("get_investigation_state: player state query failed", queryErrors.map(e => e?.code));
    return fail("state_read_failed", 500, "Не удалось загрузить состояние расследования.");
  }

  const openedMaterialIds = (materialsState.data ?? []).map(x => x.material_id);
  const visiblePuzzleStates = (puzzlesState.data ?? []).filter(x => x.status !== "locked");
  const availablePuzzleIds = visiblePuzzleStates.map(x => x.puzzle_id);
  const hypothesisIds = (hypotheses.data ?? []).map(x => x.id);
  const reportIds = (reports.data ?? []).map(x => x.id);

  const [materialRows, puzzleRows, hypothesisRevisions, reportAnswers, reportRevisions] =
    await Promise.all([
      openedMaterialIds.length
        ? db.schema("game").from("materials")
            .select("id, code, title, material_type, public_content, sort_order")
            .eq("case_version_id", investigation.case_version_id).in("id", openedMaterialIds)
        : Promise.resolve({ data: [], error: null }),
      availablePuzzleIds.length
        ? db.schema("game").from("puzzles")
            .select("id, code, title, public_question, answer_type, max_hint_level, sort_order")
            .eq("case_version_id", investigation.case_version_id).in("id", availablePuzzleIds)
        : Promise.resolve({ data: [], error: null }),
      hypothesisIds.length
        ? db.schema("game").from("hypothesis_revisions")
            .select("id, hypothesis_id, revision_number, action, title, hypothesis_text, status_at_revision, change_note, created_at, created_by")
            .in("hypothesis_id", hypothesisIds).eq("created_by", userId)
            .order("revision_number", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      reportIds.length
        ? db.schema("game").from("final_report_answers")
            .select("id, report_id, question_code, answer").in("report_id", reportIds)
        : Promise.resolve({ data: [], error: null }),
      reportIds.length
        ? db.schema("game").from("final_report_revisions")
            .select("id, report_id, revision_number, free_explanation, answers_snapshot, created_at, created_by")
            .in("report_id", reportIds).order("revision_number", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);

  const detailErrors = [
    materialRows.error, puzzleRows.error, hypothesisRevisions.error,
    reportAnswers.error, reportRevisions.error
  ].filter(Boolean);
  if (detailErrors.length) {
    console.error("get_investigation_state: detail query failed", detailErrors.map(e => e?.code));
    return fail("state_read_failed", 500, "Не удалось загрузить материалы расследования.");
  }

  const { data: reportQuestions, error: reportQuestionsError } = await db
    .schema("game")
    .rpc("get_public_report_questions", { p_case_version_id: investigation.case_version_id });

  if (reportQuestionsError) {
    console.error("get_investigation_state: report question lookup failed", reportQuestionsError.code);
    return fail("state_read_failed", 500, "Не удалось загрузить форму итогового заключения.");
  }

  const safeReports = (reports.data ?? []).map(report => ({
    ...report,
    // Evaluation summaries are returned only after an actual evaluation.
    evaluation_summary: report.status === "evaluated" ? report.evaluation_summary : null,
  }));

  return json({
    ok: true,
    operation: "get_investigation_state",
    investigation: {
      id: investigation.id,
      title: investigation.title,
      status: investigation.status,
      started_at: investigation.started_at,
      updated_at: investigation.updated_at,
      case_version_id: investigation.case_version_id,
    },
    case: {
      code: caseRow.code,
      title: caseRow.title,
      short_description: caseRow.short_description,
      version_number: version.version_number,
    },
    season: {
      code: season.code,
      title: season.title,
      season_number: season.season_number,
    },
    characters: characters.data ?? [],
    opened_materials: (materialsState.data ?? []).map(state => ({
      state,
      material: (materialRows.data ?? []).find(item => item.id === state.material_id) ?? null,
    })),
    puzzles: (puzzlesState.data ?? []).map(state => ({
      // A locked puzzle exposes neither its content nor its identifier to the player.
      state: state.status === "locked"
        ? { ...state, puzzle_id: null, submitted_answer: null }
        : state,
      puzzle: state.status === "locked"
        ? null
        : (puzzleRows.data ?? []).find(item => item.id === state.puzzle_id) ?? null,
    })),
    notes: (notes.data ?? []).map(note => ({
      ...note,
      revisions: (noteRevisions.data ?? []).filter(revision => revision.note_id === note.id),
    })),
    links: (links.data ?? []).map(link => ({
      ...link,
      revisions: (linkRevisions.data ?? []).filter(revision => revision.link_id === link.id),
    })),
    hypotheses: (hypotheses.data ?? []).map(hypothesis => ({
      ...hypothesis,
      revisions: (hypothesisRevisions.data ?? []).filter(revision => revision.hypothesis_id === hypothesis.id),
    })),
    suspects: suspects.data ?? [],
    final_report_questions: reportQuestions ?? [],
    final_reports: safeReports.map(report => ({
      ...report,
      answers: (reportAnswers.data ?? []).filter(answer => answer.report_id === report.id),
      revisions: (reportRevisions.data ?? []).filter(revision => revision.report_id === report.id),
    })),
    recent_events: events.data ?? [],
    summary: summary.data ?? null,
    limits: {
      notes: 300,
      links: 500,
      hypotheses: 200,
      final_reports: 50,
      recent_events: 200,
    },
  });
});

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  return handler(req);
});
