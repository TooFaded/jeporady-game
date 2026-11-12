-- Apply once to a Supabase project. All application mutations are service-role RPCs.
create table public.game_rooms (
 id uuid primary key default gen_random_uuid(),
 room_code text not null check (room_code ~ '^[A-HJ-NP-Z2-9]{6}$'),
 host_name text not null check (char_length(host_name) between 2 and 24),
 status text not null default 'lobby' check (status in ('lobby','in_progress','completed','cancelled')),
 settings jsonb not null default '{"max_players":16}'::jsonb check (jsonb_typeof(settings) = 'object'),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 expires_at timestamptz not null default now() + interval '24 hours'
);
create unique index active_room_codes on public.game_rooms(room_code) where status in ('lobby','in_progress');
create index room_expiry on public.game_rooms(expires_at);
create table public.game_players (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.game_rooms on delete cascade,
 nickname text not null check (char_length(nickname) between 2 and 24), score integer not null default 0,
 is_connected boolean not null default true, joined_at timestamptz not null default now(),
 updated_at timestamptz not null default now(), last_seen_at timestamptz not null default now(), left_at timestamptz
);
create unique index active_player_nicknames on public.game_players(room_id,lower(nickname)) where left_at is null;
create index players_room on public.game_players(room_id);
create table public.game_sessions (
 id uuid primary key default gen_random_uuid(), room_id uuid not null unique references public.game_rooms on delete cascade,
 current_round integer not null default 1 check(current_round > 0), current_clue_id uuid,
 game_state jsonb not null default '{}'::jsonb, started_at timestamptz not null default now(), finished_at timestamptz
);
-- Credential digests only. This table is never readable by browser roles.
create table public.room_credentials (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.game_rooms on delete cascade,
 player_id uuid references public.game_players on delete cascade, role text not null check(role in ('host','player')),
 token_hash text not null unique check(length(token_hash)=64), revoked_at timestamptz, last_seen_at timestamptz not null default now(),
 check ((role='host' and player_id is null) or (role='player' and player_id is not null))
);
create index credentials_room on public.room_credentials(room_id);
create table public.request_limits (key text primary key, bucket timestamptz not null, hits integer not null);

alter table public.game_rooms enable row level security;
alter table public.game_players enable row level security;
alter table public.game_sessions enable row level security;
alter table public.room_credentials enable row level security;
alter table public.request_limits enable row level security;
revoke all on public.game_rooms, public.game_players, public.game_sessions, public.room_credentials, public.request_limits from anon, authenticated;
grant all on public.game_rooms, public.game_players, public.game_sessions, public.room_credentials, public.request_limits to service_role;

create function public.consume_rate_limit(p_key text, p_limit integer) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_hits integer;
begin
 insert into public.request_limits as limits(key,bucket,hits) values(p_key,date_trunc('minute',clock_timestamp()),1)
 on conflict(key) do update set bucket=excluded.bucket, hits=case when limits.bucket=excluded.bucket then limits.hits+1 else 1 end
 returning hits into v_hits;
 -- Bounded retention without a separate server process.
 delete from public.request_limits where bucket < now()-interval '1 day';
 return v_hits <= p_limit;
end $$;

create function public.room_command(p_action text,p_code text,p_token_hash text,p_name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.game_rooms; c public.room_credentials; player uuid; result jsonb;
begin
 if p_action not in ('create','join','state','heartbeat','start','leave') then raise exception 'BAD_REQUEST'; end if;
 if p_code !~ '^[A-HJ-NP-Z2-9]{6}$' or length(p_token_hash)<>64 then raise exception 'BAD_REQUEST'; end if;
 if p_action in ('create','join') and (p_name is null or char_length(trim(p_name)) not between 2 and 24) then raise exception 'BAD_REQUEST'; end if;
 if p_action='create' then
   update public.game_rooms set status='cancelled',updated_at=now() where room_code=p_code and expires_at<=now() and status in ('lobby','in_progress');
   begin
    insert into public.game_rooms(room_code,host_name) values(p_code,trim(p_name)) returning * into r;
   exception when unique_violation then raise exception 'CODE_TAKEN'; end;
   insert into public.room_credentials(room_id,role,token_hash) values(r.id,'host',p_token_hash) returning * into c;
 else
   -- The row lock serializes joins, capacity checks, starts, and leaves across serverless instances.
   select * into r from public.game_rooms where room_code=p_code order by created_at desc limit 1 for update;
   if not found then raise exception 'NOT_FOUND'; end if;
   if p_action='join' then
     if r.status<>'lobby' or r.expires_at<=now() then raise exception 'CLOSED'; end if;
     if exists(select 1 from public.game_players where room_id=r.id and left_at is null and lower(nickname)=lower(trim(p_name))) then raise exception 'DUPLICATE_NAME'; end if;
     if (select count(*) from public.game_players where room_id=r.id and left_at is null) >= (r.settings->>'max_players')::integer then raise exception 'FULL'; end if;
     insert into public.game_players(room_id,nickname) values(r.id,trim(p_name)) returning id into player;
     insert into public.room_credentials(room_id,player_id,role,token_hash) values(r.id,player,'player',p_token_hash) returning * into c;
   else
     select * into c from public.room_credentials where room_id=r.id and token_hash=p_token_hash and revoked_at is null;
     if not found or r.expires_at<=now() then raise exception 'UNAUTHORIZED'; end if;
     if p_action='heartbeat' then
       update public.room_credentials set last_seen_at=now() where id=c.id;
       update public.game_players set last_seen_at=now(),is_connected=true,updated_at=now() where id=c.player_id and left_at is null;
     elsif p_action='start' then
       if c.role<>'host' then raise exception 'HOST_ONLY'; end if;
       if r.status<>'lobby' then raise exception 'CLOSED'; end if;
       if not exists(select 1 from public.game_players where room_id=r.id and left_at is null and is_connected and last_seen_at>now()-interval '45 seconds') then raise exception 'EMPTY_ROOM'; end if;
       update public.game_rooms set status='in_progress',updated_at=now() where id=r.id returning * into r;
       insert into public.game_sessions(room_id) values(r.id);
     elsif p_action='leave' then
       update public.room_credentials set revoked_at=now() where id=c.id;
       update public.game_players set left_at=now(),is_connected=false,updated_at=now() where id=c.player_id;
       if c.role='host' then
         update public.game_rooms set status='cancelled',updated_at=now() where id=r.id;
         update public.game_sessions set finished_at=now() where room_id=r.id;
         update public.room_credentials set revoked_at=now() where room_id=r.id;
       end if;
       perform realtime.send(jsonb_build_object('changed',true),'room_changed','room:'||r.id::text,true);
       return null;
     end if;
   end if;
 end if;
 if p_action in ('create','join','start') then
   perform realtime.send(jsonb_build_object('changed',true),'room_changed','room:'||r.id::text,true);
 end if;
 select jsonb_build_object(
   'id',r.id,'room_code',r.room_code,'host_name',r.host_name,'status',r.status,'settings',r.settings,'expires_at',r.expires_at,
   'host_connected',exists(select 1 from public.room_credentials where room_id=r.id and role='host' and revoked_at is null and last_seen_at>now()-interval '45 seconds'),
   'viewer',jsonb_build_object('id',c.id,'role',c.role,'player_id',c.player_id),
   'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'nickname',p.nickname,'score',p.score,'joined_at',p.joined_at,
     'is_connected',p.is_connected and p.last_seen_at>now()-interval '45 seconds') order by p.joined_at) from public.game_players p where p.room_id=r.id and p.left_at is null),'[]'::jsonb)
 ) into result;
 return result;
end $$;
revoke all on function public.room_command(text,text,text,text) from public,anon,authenticated;
revoke all on function public.consume_rate_limit(text,integer) from public,anon,authenticated;
grant execute on function public.room_command(text,text,text,text) to service_role;
grant execute on function public.consume_rate_limit(text,integer) to service_role;

-- Short-lived JWTs identify a credential, never grant browser table access.
create function public.can_access_room_topic(topic text) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists (
   select 1 from public.room_credentials c join public.game_rooms r on r.id=c.room_id
   where c.id::text=(auth.jwt()->>'session_id') and c.room_id::text=(auth.jwt()->>'room_id')
   and topic='room:'||r.id::text and c.revoked_at is null and r.expires_at>now() and r.status in ('lobby','in_progress')
 );
$$;
revoke all on function public.can_access_room_topic(text) from public,anon;
grant execute on function public.can_access_room_topic(text) to authenticated;
create policy "Participants receive room events" on realtime.messages for select to authenticated
 using (extension in ('broadcast','presence') and public.can_access_room_topic(realtime.topic()));
create policy "Participants publish presence only" on realtime.messages for insert to authenticated
 with check (extension='presence' and public.can_access_room_topic(realtime.topic()));
