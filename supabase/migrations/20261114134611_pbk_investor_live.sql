-- Isolated live investor portal. No staging records, CRM tables or existing auth settings are changed.
create table public.pbk_investor_portal_state (
  id text primary key check (id = 'live'),
  revision bigint not null default 0,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);
alter table public.pbk_investor_portal_state enable row level security;
revoke all on public.pbk_investor_portal_state from public, anon, authenticated;
grant select, update on public.pbk_investor_portal_state to service_role;
insert into public.pbk_investor_portal_state(id,data)
values ('live','{"members":{},"properties":{},"inquiries":{},"saved":{},"sessions":{},"audit":[]}'::jsonb);

create function public.pbk_investor_portal_commit(expected_revision bigint, next_data jsonb)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  if octet_length(next_data::text) > 12000000 then raise exception 'Portal capacity reached'; end if;
  update public.pbk_investor_portal_state
  set data=next_data, revision=revision+1, updated_at=now()
  where id='live' and revision=expected_revision;
  get diagnostics changed = row_count;
  return changed=1;
end;
$$;
revoke all on function public.pbk_investor_portal_commit(bigint,jsonb) from public, anon, authenticated;
grant execute on function public.pbk_investor_portal_commit(bigint,jsonb) to service_role;
comment on table public.pbk_investor_portal_state is 'Private live investor aggregate. Service-role only; approved roles enforced by pbk-investor-portal. Isolated from staging.';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('pbk-investor-portal','pbk-investor-portal',false,10000000,array['application/pdf','image/jpeg','image/png','image/webp']);
-- No public/authenticated storage policies are added. Only the validated live function issues files.
