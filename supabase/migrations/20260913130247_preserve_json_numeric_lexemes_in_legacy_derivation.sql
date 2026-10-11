-- The production checkpoint JSON was emitted by JSON.stringify before jsonb
-- ingestion, so jsonb's retained numeric lexemes are already the canonical JS
-- bytes. A read-only rev26 hash comparison proved that float8 conversion loses
-- 16 characters and changes the historical hash; preserve jsonb scalar text.
create or replace function public.legacy_stable_json(p_value jsonb)
returns text language plpgsql immutable strict set search_path='' as $$
declare v_type text:=jsonb_typeof(p_value); v_result text;
begin
  if v_type='object' then
    select '{'||coalesce(string_agg(to_json(key)::text||':'||public.legacy_stable_json(value),',' order by
      case when public.is_canonical_json_array_index(key) then 0 else 1 end,
      case when public.is_canonical_json_array_index(key) then key::numeric end,
      case when not public.is_canonical_json_array_index(key) then key collate "en-US-x-icu" end),'')||'}'
      into v_result from jsonb_each(p_value);
    return v_result;
  elsif v_type='array' then
    select '['||coalesce(string_agg(public.legacy_stable_json(value),',' order by ordinal),'')||']'
      into v_result from jsonb_array_elements(p_value) with ordinality as item(value,ordinal);
    return v_result;
  end if;
  return p_value::text;
end $$;
revoke all on function public.legacy_stable_json(jsonb) from public,anon,authenticated;
