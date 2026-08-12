-- Transactional WP-41 RLS/RPC smoke test. Leaves no rows behind.
begin;
select set_config('request.jwt.claim.sub', (select id::text from auth.users order by created_at limit 1), true);
do $$
declare v_user uuid := auth.uid(); v_assignment uuid; v_content jsonb; v_revision integer;
begin
  if v_user is null then raise exception 'WP-41 test requires an auth user'; end if;
  insert into public.authorization_role_assignments (user_id, role, scope_type, scope_id, issued_by) values (v_user, 'EXCON', 'EXERCISE', 'WP41-SQL', v_user) returning id into v_assignment;
  v_content := jsonb_build_object('evaluationId','IE-WP41-SQL','schemaVersion',1,'exerciseId','WP41-SQL','source',jsonb_build_object('evaluationProfileId','ALS','evaluationProfileVersion','1','evaluationProfileHash','PH','evaluationHash','EH'),'evaluator',jsonb_build_object('userId',v_user::text),'dimensionJudgements','[]'::jsonb,'expectationJudgements','[]'::jsonb,'revision',1,'createdAt',now()::text,'updatedAt',now()::text);
  perform public.save_instructor_evaluation_revision('IE-WP41-SQL','WP41-SQL',0,'ALS','1','PH','EH',v_content);
  select current_revision into v_revision from public.instructor_evaluations where exercise_id='WP41-SQL'; if v_revision <> 1 then raise exception 'Revision one missing'; end if;
  begin perform public.save_instructor_evaluation_revision('IE-WP41-SQL','WP41-SQL',0,'ALS','1','PH','EH',v_content); raise exception 'Expected revision conflict'; exception when others then if sqlerrm not like '%REVISION_CONFLICT%' then raise; end if; end;
  if not exists (select 1 from public.authorization_audit where exercise_id='WP41-SQL' and operation='INSTRUCTOR_EVALUATION_REVISION' and decision='AUTHORIZED') then raise exception 'Write audit missing'; end if;
end $$;
rollback;
