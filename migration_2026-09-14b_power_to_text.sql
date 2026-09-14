-- 3475 Transfer Portal — Power / Hero Power / Total Hero Power become free text
-- Run this ENTIRE file in the Supabase SQL Editor.
--
-- WHY:
-- Power, Hero Power and Total Hero Power were bigint columns (numbers only).
-- The frontend now accepts free text for these fields (e.g. "1.5M", "999K+"),
-- so the columns and the submit_transfer_application() RPC are updated to
-- accept text instead of bigint.
--
-- Existing numeric values are preserved as-is (bigint -> text keeps the same
-- digits, e.g. 309331601 becomes '309331601').

-- 1. Convert the table columns to text
alter table public.player_transfers
    alter column power type text using power::text,
    alter column hero_power type text using hero_power::text,
    alter column total_hero_power type text using total_hero_power::text;

-- 2. Drop every existing overload of submit_transfer_application (regardless
--    of its old signature) so PostgREST can never resolve the RPC call to a
--    stale bigint-based version.
do $$
declare
    r record;
begin
    for r in
        select p.oid::regprocedure as full_signature
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'submit_transfer_application'
    loop
        execute format('drop function if exists %s cascade;', r.full_signature);
    end loop;
end $$;

-- 3. Recreate submit_transfer_application with text power/hero_power/total_hero_power
create or replace function public.submit_transfer_application(
    p_transfer_from_state integer,
    p_nickname text,
    p_game_id text,
    p_desired_alliance text,
    p_furnace_level integer,
    p_power text,
    p_hero_power text,
    p_total_hero_power text,
    p_referrer text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
    v_max_slots integer;
    v_accepted integer;
    v_id bigint;
    v_code text;
begin
    if p_transfer_from_state < 0
       or p_furnace_level < 1 or p_furnace_level > 10 then
        raise exception 'Invalid numeric application data';
    end if;

    if nullif(trim(p_nickname), '') is null
       or nullif(trim(p_game_id), '') is null
       or nullif(trim(p_desired_alliance), '') is null
       or nullif(trim(p_power), '') is null
       or nullif(trim(p_hero_power), '') is null
       or nullif(trim(p_total_hero_power), '') is null then
        raise exception 'Required application fields are missing';
    end if;

    select max_slots
      into v_max_slots
      from public.system_settings
     where id = '1'
     for update;

    if v_max_slots is null then
        raise exception 'Transfer quota configuration is missing';
    end if;

    select count(*)::integer
      into v_accepted
      from public.player_transfers
     where status = 'Accepted';

    if v_accepted >= v_max_slots then
        raise exception 'REGISTRATION_QUOTA_FULL';
    end if;

    loop
        v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));
        exit when not exists (
            select 1 from public.player_transfers
             where notification_recovery_code = v_code
        );
    end loop;

    insert into public.player_transfers (
        transfer_from_state,
        nickname,
        game_id,
        desired_alliance,
        furnace_level,
        power,
        hero_power,
        total_hero_power,
        referrer,
        status,
        notification_recovery_code
    ) values (
        p_transfer_from_state,
        trim(p_nickname),
        trim(p_game_id),
        trim(p_desired_alliance),
        p_furnace_level,
        trim(p_power),
        trim(p_hero_power),
        trim(p_total_hero_power),
        nullif(trim(coalesce(p_referrer, '')), ''),
        'Waiting',
        v_code
    )
    returning id into v_id;

    return jsonb_build_object(
        'id', v_id,
        'notification_recovery_code', v_code
    );
end;
$$;

revoke all on function public.submit_transfer_application(integer, text, text, text, integer, text, text, text, text) from public;
grant execute on function public.submit_transfer_application(integer, text, text, text, integer, text, text, text, text) to anon, authenticated;

-- Verify: column types
select table_name, column_name, data_type
from information_schema.columns
where table_name = 'player_transfers'
  and column_name in ('power', 'hero_power', 'total_hero_power');

-- Verify: only one submit_transfer_application overload remains
select p.proname, p.oid::regprocedure as signature
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'submit_transfer_application';
