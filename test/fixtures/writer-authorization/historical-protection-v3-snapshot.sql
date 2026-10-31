SELECT jsonb_build_object(
 'functions',(SELECT jsonb_agg(jsonb_build_object(
  'signature',p.oid::regprocedure::text,'owner',pg_get_userbyid(p.proowner),
  'security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,
  'sha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
  'body_sha256',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'))
 ORDER BY p.oid::regprocedure::text)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('rc_checkpoint_maintenance','rc_history')),
 'triggers',(SELECT jsonb_agg(jsonb_build_object('relation',t.tgrelid::regclass::text,
  'name',t.tgname,'enabled',t.tgenabled,'definition',pg_get_triggerdef(t.oid))
  ORDER BY t.tgrelid::regclass::text,t.tgname)
 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE NOT t.tgisinternal AND (n.nspname IN ('rc_history','rc_checkpoint_maintenance') OR t.tgname IN ('a0_historical_identity_guard','a0_bounded_delta_delete_guard','identity_immutable'))),
 'tables',(SELECT jsonb_agg(jsonb_build_object('relation',c.oid::regclass::text,
  'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity)
  ORDER BY c.oid::regclass::text)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND
 (n.nspname='rc_checkpoint_maintenance' OR c.oid IN ('rc_history.identities'::regclass,'rc_history.allocations'::regclass))),
 'columns',(SELECT jsonb_agg(jsonb_build_object('relation',c.oid::regclass::text,'position',a.attnum,
  'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
  'identity',a.attidentity,'default',pg_get_expr(d.adbin,d.adrelid),'acl',a.attacl::text)
 ORDER BY c.oid::regclass::text,a.attnum)
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE c.relkind='r' AND(n.nspname='rc_checkpoint_maintenance' OR c.oid IN ('rc_history.identities'::regclass,'rc_history.allocations'::regclass))),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('relation',c.conrelid::regclass::text,
  'name',c.conname,'definition',pg_get_constraintdef(c.oid),'validated',c.convalidated)
 ORDER BY c.conrelid::regclass::text,c.conname)
 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
 WHERE n.nspname='rc_checkpoint_maintenance' OR c.conrelid IN ('rc_history.identities'::regclass,'rc_history.allocations'::regclass)),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname)
 FROM pg_policies p WHERE schemaname='rc_checkpoint_maintenance' OR(schemaname='rc_history' AND tablename IN ('identities','allocations')) OR policyname IN ('rc_identity_profile_read','rc_identity_bootstrap_read')),
 'private_schema',(SELECT jsonb_build_object('owner',pg_get_userbyid(nspowner),'acl',nspacl::text)
 FROM pg_namespace WHERE nspname='rc_checkpoint_maintenance'),
 'sequences',(SELECT jsonb_agg(jsonb_build_object('relation',c.oid::regclass::text,'owner',pg_get_userbyid(c.relowner),'acl',c.relacl::text)
 ORDER BY c.oid::regclass::text) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='rc_checkpoint_maintenance' AND c.relkind='S'),
 'identity_owner_role',(SELECT jsonb_build_object('login',rolcanlogin,'superuser',rolsuper,'create_db',rolcreatedb,'create_role',rolcreaterole,'inherit',rolinherit,'bypass_rls',rolbypassrls) FROM pg_roles WHERE rolname='rc_identity_owner'),
 'allocation_dependency_access',jsonb_build_object(
  'profile_user_id_select',has_column_privilege('rc_identity_owner','public.operator_profiles','user_id','SELECT'),
  'profile_status_select',has_column_privilege('rc_identity_owner','public.operator_profiles','status','SELECT'),
  'profile_full_table_select',has_table_privilege('rc_identity_owner','public.operator_profiles','SELECT'),
  'bootstrap_select',has_table_privilege('rc_identity_owner','public.exercise_bootstrap_authorizations','SELECT'),
  'auth_schema_usage',has_schema_privilege('rc_identity_owner','auth','USAGE'),
  'auth_uid_execute',has_function_privilege('rc_identity_owner','auth.uid()','EXECUTE'),
  'auth_jwt_execute',has_function_privilege('rc_identity_owner','auth.jwt()','EXECUTE'),
  'parsed_actor_helper',(SELECT prosqlbody IS NOT NULL FROM pg_proc WHERE oid='rc_history.request_actor()'::regprocedure),
  'parsed_anonymous_helper',(SELECT prosqlbody IS NOT NULL FROM pg_proc WHERE oid='rc_history.request_is_anonymous()'::regprocedure)),
 'api_effective_access',(SELECT jsonb_agg(jsonb_build_object('role',r,
  'history_schema_usage',has_schema_privilege(r,'rc_history','USAGE'),
  'history_assert_execute',has_function_privilege(r,'rc_history.assert_operational_id(text)','EXECUTE'),
  'schema_usage',has_schema_privilege(r,'rc_checkpoint_maintenance','USAGE'),
  'schema_create',has_schema_privilege(r,'rc_checkpoint_maintenance','CREATE'),
  'function_execute',EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='rc_checkpoint_maintenance' AND has_function_privilege(r,p.oid,'EXECUTE')),
  'table_rights',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='rc_checkpoint_maintenance' AND c.relkind='r' AND has_table_privilege(r,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')),
  'sequence_rights',EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='rc_checkpoint_maintenance' AND c.relkind='S' AND has_sequence_privilege(r,c.oid,'USAGE,SELECT,UPDATE')))
 ORDER BY r) FROM unnest(ARRAY['anon','authenticated','service_role']) r)
) AS snapshot;
