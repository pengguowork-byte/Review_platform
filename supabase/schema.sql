-- Run once in the Supabase SQL editor. No Storage bucket is needed.
begin;
create table if not exists public.review_sync (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version bigint not null default 1 check (version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and payload->>'version' = '1' and octet_length(payload::text) <= 8388608),
  updated_at timestamptz not null default now()
);
alter table public.review_sync enable row level security;
revoke all on public.review_sync from anon;
grant select, insert, update on public.review_sync to authenticated;
drop policy if exists own_review_data on public.review_sync;
create policy own_review_data on public.review_sync for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Atomic compare-and-swap. Invoker permissions and RLS apply to every operation.
create or replace function public.save_review_sync(expected_version bigint, new_payload jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  uid uuid := auth.uid();
  saved_version bigint;
begin
  if uid is null then raise exception 'Authentication required'; end if;
  if expected_version < 0 or expected_version is null then raise exception 'Invalid version'; end if;
  if new_payload is null or jsonb_typeof(new_payload) <> 'object'
    or new_payload->>'version' is distinct from '1'
    or jsonb_typeof(new_payload->'library') is distinct from 'object'
    or jsonb_typeof(new_payload->'progress') is distinct from 'object'
    or jsonb_typeof(new_payload->'preferences') is distinct from 'object'
    or octet_length(new_payload::text) > 8388608 then raise exception 'Invalid or oversized sync payload'; end if;
  if expected_version = 0 then
    insert into public.review_sync(user_id, version, payload)
    values(uid, 1, new_payload) on conflict(user_id) do nothing
    returning version into saved_version;
  else
    update public.review_sync set payload = new_payload, version = version + 1, updated_at = now()
    where user_id = uid and version = expected_version
    returning version into saved_version;
  end if;
  return jsonb_build_object('accepted', saved_version is not null, 'version', saved_version);
end;
$$;
revoke all on function public.save_review_sync(bigint,jsonb) from public, anon;
grant execute on function public.save_review_sync(bigint,jsonb) to authenticated;
commit;
