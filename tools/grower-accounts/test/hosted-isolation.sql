-- Run on the dedicated beta project. The synthetic identities and farms are rolled back.
begin;
select set_config('grower_test.a',gen_random_uuid()::text,true),
       set_config('grower_test.b',gen_random_uuid()::text,true);
insert into auth.users(id,email,email_confirmed_at) values
  (current_setting('grower_test.a')::uuid,current_setting('grower_test.a') || '@example.invalid',now()),
  (current_setting('grower_test.b')::uuid,current_setting('grower_test.b') || '@example.invalid',now());
set local role authenticated;
do $$
declare
  a uuid := current_setting('grower_test.a')::uuid;
  b uuid := current_setting('grower_test.b')::uuid;
  plan jsonb := '{"gardens":[],"beds":[],"plantings":[]}';
begin
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.start_grower_farm(a,'a'||left(replace(a::text,'-',''),20),'Test field A',plan);
  perform set_config('request.jwt.claim.sub',b::text,true);
  if exists(select 1 from public.grower_farms) then raise exception 'Another farm was visible'; end if;
  perform public.start_grower_farm(b,'b'||left(replace(b::text,'-',''),20),'Test field B',plan);
  begin
    perform public.save_grower_farm(a,1,plan);
    raise exception 'Another owner was accepted';
  exception when insufficient_privilege then null;
  end;
  perform public.save_grower_farm(b,1,plan);
  begin
    perform public.save_grower_farm(b,1,plan);
    raise exception 'Stale revision was accepted';
  exception when serialization_failure then null;
  end;
  if (select count(*) from public.grower_farms) <> 1 then raise exception 'Wrong farm count'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  if (select revision from public.grower_farms) <> 1 then raise exception 'First farm changed'; end if;
end;
$$;
select 'Passed owner isolation, account switching, and stale saves. Test rows rolled back.' as result;
rollback;
