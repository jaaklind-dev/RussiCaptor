-- RussiCaptor shared exercise state. Run this in Supabase SQL Editor.

create table if not exists public.exercise_states (
  exercise_id text primary key,
  revision bigint not null default 1,
  state jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid not null references auth.users(id)
);

alter table public.exercise_states enable row level security;

create policy "authenticated users can read exercise state"
on public.exercise_states
for select
to authenticated
using (true);

create policy "authenticated users can create exercise state"
on public.exercise_states
for insert
to authenticated
with check (updated_by = auth.uid());

create policy "authenticated users can update exercise state"
on public.exercise_states
for update
to authenticated
using (true)
with check (updated_by = auth.uid());

alter publication supabase_realtime add table public.exercise_states;
