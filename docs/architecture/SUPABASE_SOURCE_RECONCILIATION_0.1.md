# Supabase source reconciliation inventory — 0.1

**Date:** 2026-11-17  
**Project:** `wwmlwgqzzseqauozzolx`  
**Repository:** `SirNickyMouse/sector-zero.`  
**Branch:** `feature/player-investigation-ui`

## Scope and safety

Read-only inventory of the live Supabase project and the GitHub branch. No database writes, migrations, Edge Function deployments, case edits, or publication changes were performed.

## Live Supabase inventory

- Applied migrations: **46**
- Active Edge Functions: **20**
- Current migration inventory and function versions were read from Supabase on 2026-11-17.

### Applied migrations

| Version | Name |
|---|---|
| `20261101135028` | `sector_zero_base_schema_v041` |
| `20261101135203` | `sector_zero_author_rls_lockdown` |
| `20261101135348` | `sector_zero_author_rls_hardening` |
| `20261101135726` | `sector_zero_start_investigation_v01` |
| `20261101135828` | `sector_zero_start_investigation_idempotency_v01` |
| `20261101140150` | `sector_zero_open_material_v01` |
| `20261101140509` | `sector_zero_submit_puzzle_answer_v01` |
| `20261101140905` | `sector_zero_request_hint_v01` |
| `20261101141158` | `sector_zero_save_note_v01` |
| `20261101141242` | `sector_zero_save_note_indexes_v01` |
| `20261101141547` | `sector_zero_save_link_v01` |
| `20261101141655` | `sector_zero_save_link_endpoint_validation_fix_v01` |
| `20261101141836` | `sector_zero_save_link_indexes_v01` |
| `20261101142652` | `sector_zero_save_hypothesis_revision_v01` |
| `20261101142743` | `sector_zero_save_hypothesis_idempotency_action_v01` |
| `20261102051704` | `sector_zero_save_final_report_revision_v01` |
| `20261102051918` | `sector_zero_submit_final_report_v01` |
| `20261102051958` | `sector_zero_submit_final_report_hardening_v01` |
| `20261102052226` | `sector_zero_evaluate_final_report_v01` |
| `20261102052232` | `sector_zero_evaluate_final_report_idempotency_fix_v01` |
| `20261102052259` | `sector_zero_evaluate_final_report_player_feedback_v01` |
| `20261102052308` | `sector_zero_evaluate_final_report_evidence_json_fix_v01` |
| `20261102052448` | `sector_zero_evaluate_final_report_claim_reasoning_v01` |
| `20261102052455` | `sector_zero_evaluate_final_report_submission_status_fix_v01` |
| `20261102052518` | `sector_zero_evaluate_final_report_reasoning_points_v01` |
| `20261102052824` | `sector_zero_validate_solution_rubric_v01` |
| `20261102052840` | `sector_zero_validate_solution_rubric_null_guard_v01` |
| `20261102053100` | `sector_zero_final_report_question_contract_v01` |
| `20261102053125` | `sector_zero_final_report_contract_enforcement_v01` |
| `20261102053612` | `sector_zero_authoring_draft_creation_v01` |
| `20261102053802` | `sector_zero_authoring_character_material_save_v01` |
| `20261102053820` | `sector_zero_authoring_material_type_validation_fix_v01` |
| `20261102054627` | `sector_zero_prepublication_case_validator_v01` |
| `20261102054933` | `sector_zero_case_version_publication_v01` |
| `20261103140724` | `expose_author_schema_to_service_role_api_v01` |
| `20261104094333` | `expose_game_schema_with_existing_rls_v01` |
| `20261105050407` | `remove_game_schema_from_postgrest_exposure_v02` |
| `20261105050615` | `author_case_workspace_read_v01` |
| `20261105054533` | `harden_open_material_published_case_guard` |
| `20261105054549` | `restrict_direct_material_reads_to_server` |
| `20261105054611` | `limit_material_rls_to_player_opened_items` |
| `20261105074543` | `sector_zero_reexpose_game_schema_to_postgrest_v01` |
| `20261107155657` | `lock_game_data_api_and_rate_limit_puzzles` |
| `20261107155816` | `disable_public_execute_for_future_game_functions` |
| `20261107155949` | `rate_limit_puzzle_attempts_per_player` |
| `20261111083710` | `add_qa_investigation_stage_engine` |

### Active Edge Functions

| Function | Active version |
|---|---:|
| `get_investigation_state` | 10 |
| `start_investigation` | 3 |
| `open_material` | 1 |
| `submit_puzzle_answer` | 2 |
| `request_hint` | 1 |
| `save_note` | 1 |
| `save_link` | 1 |
| `save_hypothesis_revision` | 1 |
| `save_final_report_revision` | 3 |
| `submit_final_report` | 4 |
| `evaluate_final_report` | 3 |
| `author_access` | 1 |
| `author_command` | 2 |
| `author_dashboard` | 2 |
| `author_portal` | 4 |
| `publish_author_portal_once` | 1 |
| `author_case_workspace` | 1 |
| `player_catalog` | 2 |
| `player_material_catalog` | 2 |
| `player_evidence_catalog` | 1 |

## GitHub branch inventory

At the inspected branch tree:

- Tracked migration SQL files: **3**
- Tracked Edge Function source directories: **3**
  - `get_investigation_state`
  - `player_material_catalog`
  - `submit_puzzle_answer`

The three tracked migration filenames are:

- `20261107155000_lock_game_data_api_and_rate_limit_puzzles.sql`
- `20261107155100_disable_public_execute_for_future_game_functions.sql`
- `20261107155200_rate_limit_puzzle_attempts_per_player.sql`

Their names resemble three applied migrations, but their timestamp prefixes do **not** match the live applied versions (`20261107155657`, `20261107155816`, `20261107155949`). The SQL content must be compared before treating them as the authoritative source for those applied migrations.

## Findings and implications

1. The live project has 46 applied migrations, while only 3 migration SQL files are tracked in this branch.
2. The live project has 20 active Edge Functions, while only 3 function source directories are tracked.
3. The live `author_command` v2 source currently allowlists `save_claim`, but does not include a contradiction-save operation. Its active source is not currently tracked in the repository.
4. The live `author_case_workspace` v1 source calls `author.get_case_workspace`; its active source is not currently tracked in the repository.
5. The live `get_investigation_state` is version 10. The branch contains a source file, but its content must be compared to the deployed version before it can be treated as a reproducible deployment source.
6. Supabase's migration history stores migration identifiers/names, not the original SQL bodies. A current schema dump or reconstructed SQL must not be mislabeled as the original historical migrations.

## Safe reconciliation plan

1. Archive the currently deployed Edge Function sources into a clearly marked **snapshot-only** directory in GitHub. Do not place this archive in the deployable `supabase/functions` tree and do not deploy it.
2. Compare the three tracked SQL files with the current database state and preserve their current contents; do not rename or rewrite migration history.
3. Recover original SQL from existing repository history/backups if available. For migrations whose original SQL cannot be recovered, create a clearly labeled schema-baseline/reconstruction artifact rather than inventing historical migration bodies.
4. Only after the source-of-truth review, make future schema and Edge Function changes through tracked source on the feature branch, then test against a separate draft/QA environment.
5. No live schema changes or deployments until separately reviewed and explicitly approved.

## Status

**Inventory complete; reconciliation not yet complete.** No production or QA state was modified.
