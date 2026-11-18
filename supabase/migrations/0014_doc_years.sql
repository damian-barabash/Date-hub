-- Сводка документов: распределение по годам — по нему ИИ выбирает «год фокуса» (текущий, если есть данные, иначе последний).
create or replace function public.doc_stats() returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (select * from public.documents where workspace_id = public.cur_ws())
  select jsonb_build_object(
    'total', (select count(*) from d),
    'pending', (select count(*) from d where status = 'new'),
    'min_date', (select min(doc_date) from d), 'max_date', (select max(doc_date) from d),
    'cats', (select coalesce(jsonb_agg(t order by t.n desc), '[]') from (select coalesce(category, '—') category, count(*) n, sum(gross) gross from d group by 1) t),
    'types', (select coalesce(jsonb_agg(t order by t.n desc), '[]') from (select coalesce(doc_type, '—') doc_type, count(*) n from d group by 1 order by 2 desc limit 20) t),
    'years', (select coalesce(jsonb_agg(t order by t.y desc nulls last), '[]') from (select to_char(doc_date, 'YYYY') y, count(*) n from d group by 1) t))
$$;
