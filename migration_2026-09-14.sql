-- 3475 Transfer Portal - safety/notification upgrade
-- Run this entire file in Supabase SQL Editor before deploying the new frontend.

create extension if not exists pgcrypto;

-- Private recovery code used only when a guest wants to restore notification
-- tracking after clearing browser data / changing device.
alter table public.player_transfers
    add column if not exists notification_recovery_code text;

create unique index if not exists player_transfers_notification_recovery_code_uidx
    on public.player_transfers (notification_recovery_code)
    where notification_recovery_code is not null;

-- Atomic guest submission. The system_settings row is locked while checking
-- the accepted quota, so two simultaneous submissions cannot both consume the
-- same last available slot. This function deliberately always creates a
-- Waiting application; acceptance is handled by the admin RPC below.
create or replace function public.submit_transfer_application(
    p_transfer_from_state integer,
    p_nickname text,
    p_game_id text,
    p_desired_alliance text,
    p_furnace_level integer,
    p_power bigint,
    p_hero_power bigint,
    p_total_hero_power bigint,
    p_referrer text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_max_slots integer;
    v_accepted integer;
    v_id bigint;
    v_code text;
begin
    if p_transfer_from_state < 0
       or p_furnace_level < 1 or p_furnace_level > 10
       or p_power < 0 or p_hero_power < 0 or p_total_hero_power < 0 then
        raise exception 'Invalid numeric application data';
    end if;

    if nullif(trim(p_nickname), '') is null
       or nullif(trim(p_game_id), '') is null
       or nullif(trim(p_desired_alliance), '') is null then
        raise exception 'Required application fields are missing';
    end if;

    -- Lock the settings row. Both this function and the admin acceptance
    -- function use the same lock, making quota decisions serialized.
    select max_slots
      into v_max_slots
      from public.system_settings
     where id = 1
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

    -- Generate an 8-character recovery code. The unique index is a second
    -- line of defense; regenerate if a collision ever occurs.
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
        p_power,
        p_hero_power,
        p_total_hero_power,
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

-- Atomic admin acceptance. Only authenticated President/Demon/Phoenix staff
-- accounts may call it. It uses the same system_settings row lock as guest
-- submission, preventing an acceptance from exceeding the configured quota.
create or replace function public.accept_transfer_application(p_transfer_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
    v_username text;
    v_max_slots integer;
    v_accepted integer;
    v_current_status text;
    v_updated_id bigint;
begin
    v_username := split_part(v_email, '@', 1);

    if auth.uid() is null
       or right(v_email, length('@3475-staff.internal')) <> '@3475-staff.internal'
       or v_username not in ('president', 'demon', 'phoenix') then
        raise exception 'Unauthorized';
    end if;

    select max_slots
      into v_max_slots
      from public.system_settings
     where id = 1
     for update;

    if v_max_slots is null then
        raise exception 'Transfer quota configuration is missing';
    end if;

    select status
      into v_current_status
      from public.player_transfers
     where id = p_transfer_id
     for update;

    if v_current_status is null then
        raise exception 'Application not found';
    end if;

    if v_current_status = 'Accepted' then
        return jsonb_build_object('id', p_transfer_id, 'status', 'Accepted', 'already_accepted', true);
    end if;

    select count(*)::integer
      into v_accepted
      from public.player_transfers
     where status = 'Accepted';

    if v_accepted >= v_max_slots then
        raise exception 'QUOTA_FULL';
    end if;

    update public.player_transfers
       set status = 'Accepted'
     where id = p_transfer_id
     returning id into v_updated_id;

    return jsonb_build_object('id', v_updated_id, 'status', 'Accepted', 'already_accepted', false);
end;
$$;

-- Recovery is intentionally done through a server-side function instead of
-- exposing a recovery-code column through a broad guest SELECT query.
create or replace function public.recover_transfer_application(
    p_transfer_id bigint,
    p_recovery_code text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row record;
begin
    select pt.id, pt.nickname, pt.status
      into v_row
      from public.player_transfers pt
     where pt.id = p_transfer_id
       and upper(trim(pt.notification_recovery_code)) = upper(trim(p_recovery_code))
     limit 1;

    if not found then
        return null;
    end if;

    return jsonb_build_object('id', v_row.id, 'nickname', v_row.nickname, 'status', v_row.status);
end;
$$;

revoke all on function public.submit_transfer_application(integer, text, text, text, integer, bigint, bigint, bigint, text) from public;
revoke all on function public.accept_transfer_application(bigint) from public;
revoke all on function public.recover_transfer_application(bigint, text) from public;

grant execute on function public.submit_transfer_application(integer, text, text, text, integer, bigint, bigint, bigint, text) to anon, authenticated;
grant execute on function public.accept_transfer_application(bigint) to authenticated;
grant execute on function public.recover_transfer_application(bigint, text) to anon, authenticated;

-- Optional hardening after you confirm the portal works:
-- The frontend no longer needs the recovery-code column in direct SELECTs.
-- If your existing RLS policy currently exposes all player_transfers to anon,
-- consider tightening SELECT policy separately after testing the public table
-- and Realtime behavior.
