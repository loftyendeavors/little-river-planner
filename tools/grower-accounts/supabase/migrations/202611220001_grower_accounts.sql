begin;

create table public.grower_farms (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z][a-z0-9_]{2,29}$'),
  name text not null check (length(trim(name)) between 1 and 100),
  revision bigint not null default 1 check (revision > 0),
  plan jsonb not null check (
    jsonb_typeof(plan) = 'object' and plan ?& array['gardens','beds','plantings']
    and jsonb_typeof(plan->'gardens') = 'array' and jsonb_typeof(plan->'beds') = 'array'
    and jsonb_typeof(plan->'plantings') = 'array' and octet_length(plan::text) <= 4000000
  )
);
alter table public.grower_farms enable row level security;
revoke all on public.grower_farms from public, anon, authenticated;
grant select on public.grower_farms to authenticated;
create policy read_own_farm on public.grower_farms for select to authenticated
  using (owner_id = (select auth.uid()));

-- Capture the owner seen by the form as well as the current request identity.
-- A tab whose session changed while saving cannot replay a previous grower's data.
create function public.start_grower_farm(expected_owner uuid, handle text, farm_name text, initial_plan jsonb)
returns public.grower_farms language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := auth.uid();
  farm public.grower_farms;
begin
  if caller is null or caller is distinct from expected_owner or not exists (
    select 1 from auth.users u where u.id = caller and u.email_confirmed_at is not null
  ) then raise exception 'Confirm your account and sign in again.' using errcode = '42501'; end if;
  select * into farm from public.grower_farms where owner_id = caller;
  if found then return farm; end if;
  insert into public.grower_farms(owner_id, username, name, plan)
    values(caller, lower(trim(handle)), trim(farm_name), initial_plan)
    on conflict (owner_id) do nothing;
  select * into strict farm from public.grower_farms where owner_id = caller;
  return farm;
end;
$$;

create function public.save_grower_farm(expected_owner uuid, expected_revision bigint, next_plan jsonb)
returns public.grower_farms language plpgsql security definer set search_path = '' as $$
declare farm public.grower_farms;
begin
  if auth.uid() is null or auth.uid() is distinct from expected_owner then
    raise exception 'Sign in to this farm again.' using errcode = '42501';
  end if;
  update public.grower_farms set plan = next_plan, revision = revision + 1
    where owner_id = auth.uid() and revision = expected_revision returning * into farm;
  if not found then raise exception 'Reopen the latest farm before saving.' using errcode = '40001'; end if;
  return farm;
end;
$$;

-- Only the server-side username sign-in adapter can translate a handle into an Auth identity.
create function public.grower_login_email(handle text)
returns text language sql stable security definer set search_path = '' as $$
  select u.email::text from public.grower_farms f join auth.users u on u.id = f.owner_id
    where f.username = lower(trim(handle)) and u.email_confirmed_at is not null;
$$;
revoke all on function public.start_grower_farm(uuid,text,text,jsonb),
  public.save_grower_farm(uuid,bigint,jsonb), public.grower_login_email(text)
  from public, anon, authenticated, service_role;
grant execute on function public.start_grower_farm(uuid,text,text,jsonb),
  public.save_grower_farm(uuid,bigint,jsonb) to authenticated;
grant execute on function public.grower_login_email(text) to service_role;

commit;
