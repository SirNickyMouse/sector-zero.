-- Player-facing game data is served only through authenticated Edge Functions.
-- Remove direct Data API access; preserve service_role and database-owner access.
REVOKE USAGE ON SCHEMA game FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA game FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA game FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA game FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA game
  REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA game
  REVOKE ALL ON SEQUENCES FROM anon, authenticated;

CREATE OR REPLACE FUNCTION game.submit_puzzle_answer_atomic(p_investigation_id uuid, p_puzzle_id uuid, p_user_id uuid, p_request_id uuid, p_answer text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'game', 'author', 'auth', 'public'
AS $function$
declare
  v_inv game.investigations%rowtype;
  v_puzzle game.puzzles%rowtype;
  v_state game.player_puzzles%rowtype;
  v_answer_key author.puzzle_answers%rowtype;
  v_config jsonb;
  v_candidate text;
  v_accepted text;
  v_correct boolean := false;
  v_duplicate game.puzzle_attempts%rowtype;
  v_newly_unlocked_puzzles integer := 0;
  v_recent_attempts integer := 0;
begin
  if p_investigation_id is null or p_puzzle_id is null
     or p_user_id is null or p_request_id is null
     or p_answer is null then
    raise exception using errcode='22004', message='missing_required_parameter';
  end if;

  select * into v_inv from game.investigations
  where id=p_investigation_id for update;
  if not found then
    raise exception using errcode='P0002', message='investigation_not_found';
  end if;

  if v_inv.owner_user_id <> p_user_id and not exists (
    select 1 from game.investigation_members
    where investigation_id=p_investigation_id and user_id=p_user_id
  ) then
    raise exception using errcode='P0002', message='investigation_not_found';
  end if;

  if v_inv.status <> 'active' then
    raise exception using errcode='P0002', message='investigation_not_active';
  end if;

  select * into v_puzzle from game.puzzles
  where id=p_puzzle_id and case_version_id=v_inv.case_version_id;
  if not found then
    raise exception using errcode='P0002', message='puzzle_not_found';
  end if;

  select * into v_state from game.player_puzzles
  where investigation_id=p_investigation_id and puzzle_id=p_puzzle_id
  for update;
  if not found then
    raise exception using errcode='P0002', message='puzzle_unavailable';
  end if;

  select * into v_duplicate from game.puzzle_attempts
  where investigation_id=p_investigation_id
    and puzzle_id=p_puzzle_id and request_id=p_request_id;
  if found then
    return jsonb_build_object(
      'puzzle_id', p_puzzle_id,
      'correct', v_duplicate.was_correct,
      'solved', v_state.status='solved',
      'already_processed', true,
      'attempts_count', v_state.attempts_count
    );
  end if;

  if v_state.status='locked' then
    raise exception using errcode='P0002', message='puzzle_locked';
  end if;

  if v_state.status='solved' then
    return jsonb_build_object(
      'puzzle_id', p_puzzle_id,
      'correct', true,
      'solved', true,
      'already_solved', true,
      'attempts_count', v_state.attempts_count
    );
  end if;

  select count(*) into v_recent_attempts
  from game.puzzle_attempts
  where investigation_id=p_investigation_id
    and puzzle_id=p_puzzle_id
    and actor_user_id=p_user_id
    and created_at > now() - interval '5 minutes';

  if v_recent_attempts >= 10 then
    raise exception using errcode='P0001', message='puzzle_rate_limited';
  end if;

  select * into v_answer_key from author.puzzle_answers
  where puzzle_id=p_puzzle_id;
  if not found or jsonb_typeof(v_answer_key.accepted_answers) <> 'array'
     or jsonb_array_length(v_answer_key.accepted_answers)=0 then
    raise exception using errcode='P0002', message='answer_key_unavailable';
  end if;

  v_config := coalesce(v_puzzle.normalization_rule, '{}'::jsonb)
              || coalesce(v_answer_key.validation_config, '{}'::jsonb);
  v_candidate := game.normalize_puzzle_answer(p_answer, v_config);
  if v_candidate is null then
    raise exception using errcode='22023', message='invalid_answer_config';
  end if;

  for v_accepted in
    select value from jsonb_array_elements_text(v_answer_key.accepted_answers)
  loop
    if game.normalize_puzzle_answer(v_accepted, v_config) = v_candidate then
      v_correct := true;
      exit;
    end if;
  end loop;

  insert into game.puzzle_attempts(
    investigation_id, puzzle_id, case_version_id, actor_user_id,
    request_id, submitted_answer, was_correct
  ) values (
    p_investigation_id, p_puzzle_id, v_inv.case_version_id, p_user_id,
    p_request_id, p_answer, v_correct
  );

  update game.player_puzzles
  set attempts_count=attempts_count+1,
      submitted_answer=p_answer,
      status=case when v_correct then 'solved' else 'available' end,
      solved_at=case when v_correct then now() else solved_at end,
      updated_at=now()
  where investigation_id=p_investigation_id and puzzle_id=p_puzzle_id;

  if v_correct then
    with rule_results as (
      select
        ur.target_id,
        count(*) filter (where ur.is_mandatory) as mandatory_count,
        count(*) filter (
          where ur.is_mandatory
            and game.evaluate_unlock_expression(p_investigation_id, ur.rule_expression)
        ) as mandatory_passed,
        count(*) filter (where not ur.is_mandatory) as optional_count,
        count(*) filter (
          where not ur.is_mandatory
            and game.evaluate_unlock_expression(p_investigation_id, ur.rule_expression)
        ) as optional_passed
      from game.unlock_rules ur
      where ur.case_version_id=v_inv.case_version_id
        and ur.target_type='puzzle'
        and ur.target_id <> p_puzzle_id
      group by ur.target_id
    ),
    unlocked as (
      update game.player_puzzles pp
      set status='available', updated_at=now()
      from rule_results rr
      where pp.investigation_id=p_investigation_id
        and pp.puzzle_id=rr.target_id
        and pp.status='locked'
        and (rr.mandatory_count=0 or rr.mandatory_passed=rr.mandatory_count)
        and (rr.optional_count=0 or rr.optional_passed>0)
      returning pp.puzzle_id
    )
    select count(*) into v_newly_unlocked_puzzles from unlocked;

    insert into game.investigation_events(
      investigation_id, actor_user_id, event_type, entity_type, entity_id, event_data
    ) values (
      p_investigation_id, p_user_id, 'puzzle_solved', 'puzzle', p_puzzle_id,
      jsonb_build_object('newly_unlocked_puzzles',v_newly_unlocked_puzzles)
    );
  else
    insert into game.investigation_events(
      investigation_id, actor_user_id, event_type, entity_type, entity_id, event_data
    ) values (
      p_investigation_id, p_user_id, 'puzzle_answer_rejected', 'puzzle', p_puzzle_id,
      jsonb_build_object('attempt_number',v_state.attempts_count+1)
    );
  end if;

  return jsonb_build_object(
    'puzzle_id', p_puzzle_id,
    'correct', v_correct,
    'solved', v_correct,
    'already_processed', false,
    'attempts_count', v_state.attempts_count+1,
    'newly_unlocked_puzzles', case when v_correct then v_newly_unlocked_puzzles else 0 end
  );
end;
$function$
;
