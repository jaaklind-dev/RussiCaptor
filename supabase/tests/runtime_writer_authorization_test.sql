-- Synthetic isolated database setup for scripts/test-writer-authorization.mjs.
-- Never run against production. The runner always constructs in-memory PG.
insert into auth.users(id,email) values
 ('10000000-0000-0000-0000-000000000001','cm-a@example.invalid'),
 ('10000000-0000-0000-0000-000000000002','excon-a@example.invalid'),
 ('10000000-0000-0000-0000-000000000003','excon-b@example.invalid'),
 ('10000000-0000-0000-0000-000000000004','admin@example.invalid');
insert into public.operator_profiles(user_id,display_name,status,updated_by)
 select id,'Synthetic operator','ACTIVE',id from auth.users;
insert into public.platform_admins(user_id,status,granted_by)
 values('10000000-0000-0000-0000-000000000004','ACTIVE','10000000-0000-0000-0000-000000000004');
