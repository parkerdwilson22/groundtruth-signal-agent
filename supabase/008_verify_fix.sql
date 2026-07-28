-- Isolated test of the corrected shot_list aggregation, no table dependency.
create or replace function debug_verify_shotlist_agg()
returns text
language sql
as $$
  select string_agg(numbered.rn::text || '. ' || numbered.shot, e'\n')
  from (
    select row_number() over () as rn, shot
    from jsonb_array_elements_text('["first shot", "second shot", "third shot"]'::jsonb) as shot
  ) numbered;
$$;

grant execute on function debug_verify_shotlist_agg() to anon, authenticated;
