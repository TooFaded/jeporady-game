-- Phase 3.5: apply once after 003. Team membership is immutable during play.
alter table public.game_boards add column play_mode text not null default 'solo' check(play_mode in ('solo','team'));
alter table public.game_boards add column teams_locked boolean not null default false;
alter table public.game_boards add column team_capacity integer not null default 8 check(team_capacity between 1 and 16);
create table public.game_teams (
 id uuid primary key default gen_random_uuid(),room_id uuid not null references public.game_rooms on delete cascade,
 position integer not null check(position between 0 and 3),name text not null check(char_length(btrim(name)) between 1 and 32),
 color text not null check(color in ('blue','gold','purple','green','teal','rose','orange','indigo')),unique(room_id,id),unique(room_id,position),unique(room_id,color)
);
create unique index distinct_team_names on public.game_teams(room_id,lower(btrim(name)));
alter table public.game_players add column team_id uuid;
alter table public.game_players add constraint player_team_room foreign key(room_id,team_id) references public.game_teams(room_id,id);
alter table public.answer_attempts add column team_id uuid;
alter table public.answer_attempts add constraint attempt_team_room foreign key(room_id,team_id) references public.game_teams(room_id,id);
create index players_team_members on public.game_players(team_id) where team_id is not null;
create index attempts_team_scores on public.answer_attempts(team_id) where team_id is not null;
create unique index one_attempt_per_team_clue on public.answer_attempts(clue_id,team_id) where team_id is not null;
alter table public.game_teams enable row level security;
revoke all on public.game_teams from anon,authenticated;
grant all on public.game_teams to service_role;

create function public.team_snapshot(rid uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('play_mode',b.play_mode,'teams_locked',b.teams_locked,'team_capacity',b.team_capacity,
 'teams',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'color',t.color,'position',t.position,
 'score',t.score,'rank',t.rank,'correct',t.correct,'incorrect',t.incorrect,
 'members',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'nickname',p.nickname,'left',p.left_at is not null,
 'correct',(select count(*) from public.answer_attempts a where a.player_id=p.id and a.outcome='correct'),
 'incorrect',(select count(*) from public.answer_attempts a where a.player_id=p.id and a.outcome='incorrect')) order by p.joined_at,p.id)
 from public.game_players p where p.team_id=t.id and (p.left_at is null or exists(select 1 from public.answer_attempts a where a.player_id=p.id))),'[]'::jsonb)) order by t.position)
 from (select x.*,rank() over(order by exists(select 1 from public.game_players p where p.team_id=x.id and (p.left_at is null or exists(select 1 from public.answer_attempts a where a.player_id=p.id))) desc,score desc) rank from (select t.*,
 coalesce((select sum(a.score_delta) from public.answer_attempts a where a.team_id=t.id),0) score,
 (select count(*) from public.answer_attempts a where a.team_id=t.id and a.outcome='correct') correct,
 (select count(*) from public.answer_attempts a where a.team_id=t.id and a.outcome='incorrect') incorrect
 from public.game_teams t where t.room_id=rid) x) t),'[]'::jsonb)) from public.game_boards b where b.room_id=rid;
$$;
alter function public.competition_snapshot(uuid) rename to competition_snapshot_solo;
revoke all on function public.competition_snapshot_solo(uuid) from public,anon,authenticated,service_role;
create function public.competition_snapshot(p_room_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; s public.game_sessions;
begin
 result:=public.competition_snapshot_solo(p_room_id)||public.team_snapshot(p_room_id);
 select * into s from public.game_sessions where room_id=p_room_id;
 if result->>'play_mode'='team' then
   result:=jsonb_set(result,'{attempted_player_ids}',coalesce((select jsonb_agg(p.id) from public.game_players p where p.room_id=p_room_id and exists(select 1 from public.answer_attempts a where a.clue_id=s.current_clue_id and a.team_id=p.team_id)),'[]'::jsonb));
 end if;
 if s.current_attempt_id is not null then
   result:=jsonb_set(result,'{attempt}',result->'attempt'||coalesce((select jsonb_build_object('team_id',t.id,'team_name',t.name) from public.answer_attempts a join public.game_teams t on t.id=a.team_id where a.id=s.current_attempt_id),'{}'::jsonb));
 end if;
 return result;
end $$;
create function public.player_can_buzz(rid uuid,cid uuid,pid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.game_players p join public.game_boards b on b.room_id=p.room_id where p.id=pid and p.room_id=rid and p.left_at is null and p.is_connected and p.last_seen_at>clock_timestamp()-interval '45 seconds'
 and (b.play_mode='solo' or p.team_id is not null)
 and not exists(select 1 from public.answer_attempts a where a.clue_id=cid and (a.player_id=pid or (b.play_mode='team' and a.team_id=p.team_id))));
$$;
create function public.team_command(p_code text,p_token_hash text,p_action text,p_expected_version integer,p_data jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; rid uuid; b public.game_boards; tid uuid; pid uuid; n integer; cap integer; item record;
begin
 r:=public.room_command('state',p_code,p_token_hash,null);rid:=(r->>'id')::uuid;
 select * into b from public.game_boards where room_id=rid;
 if r->>'status'<>'lobby' then raise exception 'TEAMS_FROZEN'; end if;
 if p_expected_version is null or p_expected_version<>b.version then raise exception 'STALE_GAME'; end if;
 if p_action<>'choose_team' and r->'viewer'->>'role'<>'host' then raise exception 'HOST_ONLY'; end if;
 if p_action='team_setup' then
   n:=(p_data->>'count')::integer;cap:=(p_data->>'capacity')::integer;
   if p_data->>'mode' is null or p_data->>'mode' not in ('solo','team') or n is null or n not between 2 and 4 or cap is null or cap not between 1 and least(16,(r->'settings'->>'max_players')::integer) then raise exception 'BAD_REQUEST'; end if;
   if (select count(*) from public.game_teams where room_id=rid)<>n then
     update public.game_players set team_id=null where room_id=rid;
     delete from public.game_teams where room_id=rid;
     for i in 0..n-1 loop insert into public.game_teams(room_id,position,name,color) values(rid,i,'Team '||(i+1), (array['blue','gold','purple','green'])[i+1]); end loop;
   end if;
   if exists(select 1 from public.game_players where room_id=rid and left_at is null and team_id is not null group by team_id having count(*)>cap) then raise exception 'TEAM_FULL'; end if;
   update public.game_boards set play_mode=p_data->>'mode',team_capacity=cap,teams_locked=false where id=b.id;
 elsif p_action='team_edit' then
   tid:=(p_data->>'teamId')::uuid;
   if not exists(select 1 from public.game_teams where id=tid and room_id=rid) then raise exception 'INVALID_TEAM'; end if;
   if p_data->>'name' is null or char_length(btrim(p_data->>'name')) not between 1 and 32 or p_data->>'color' is null or p_data->>'color' not in ('blue','gold','purple','green','teal','rose','orange','indigo') then raise exception 'BAD_REQUEST'; end if;
   begin update public.game_teams set name=btrim(p_data->>'name'),color=p_data->>'color' where id=tid; exception when unique_violation then raise exception 'TEAM_DISTINCT'; end;
 elsif p_action='team_lock' then
   if jsonb_typeof(p_data->'locked') is distinct from 'boolean' then raise exception 'BAD_REQUEST'; end if;
   update public.game_boards set teams_locked=(p_data->>'locked')::boolean where id=b.id;
 elsif p_action in ('choose_team','assign_team') then
   if b.play_mode<>'team' then raise exception 'INVALID_TRANSITION'; end if;
   if p_action='choose_team' then
     if r->'viewer'->>'role'<>'player' then raise exception 'PLAYER_ONLY'; end if;
     if b.teams_locked then raise exception 'TEAMS_LOCKED'; end if;
     pid:=(r->'viewer'->>'player_id')::uuid;
   else pid:=(p_data->>'playerId')::uuid; end if;
   tid:=(p_data->>'teamId')::uuid;
   if not exists(select 1 from public.game_players where id=pid and room_id=rid and left_at is null) then raise exception 'INVALID_TEAM'; end if;
   if tid is not null then
     if not exists(select 1 from public.game_teams where id=tid and room_id=rid) then raise exception 'INVALID_TEAM'; end if;
     if (select count(*) from public.game_players where team_id=tid and left_at is null and id<>pid)>=b.team_capacity then raise exception 'TEAM_FULL'; end if;
   end if;
   update public.game_players set team_id=tid where id=pid;
 elsif p_action='balance_teams' then
   n:=(select count(*) from public.game_teams where room_id=rid);
   if b.play_mode<>'team' or n not between 2 and 4 then raise exception 'INVALID_TRANSITION'; end if;
   if (select count(*) from public.game_players where room_id=rid and left_at is null)>n*b.team_capacity then raise exception 'TEAM_FULL'; end if;
   update public.game_players set team_id=null where room_id=rid;
   for item in select id,row_number() over(order by joined_at,id)-1 idx from public.game_players where room_id=rid and left_at is null loop
     select id into tid from public.game_teams where room_id=rid and position=mod(item.idx,n);
     update public.game_players set team_id=tid where id=item.id;
   end loop;
 else raise exception 'BAD_REQUEST'; end if;
 update public.game_boards set version=version+1,updated_at=clock_timestamp() where id=b.id;
 perform realtime.send(jsonb_build_object('changed',true),'room_changed','room:'||rid::text,true);
 return public.room_command('state',p_code,p_token_hash,null);
end $$;
alter function public.game_command(text,text,text,integer,uuid,jsonb) rename to game_command_phase_three;
revoke all on function public.game_command_phase_three(text,text,text,integer,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.game_command(p_code text,p_token_hash text,p_action text,p_expected_version integer default null,p_clue_id uuid default null,p_board jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; rid uuid;
begin
 r:=public.room_command('state',p_code,p_token_hash,null);rid:=(r->>'id')::uuid;
 if r->'viewer'->>'role'<>'host' then raise exception 'HOST_ONLY'; end if;
 if p_action='start' and r->'game'->'competition'->>'play_mode'='team' then
   if not (r->'game'->'competition'->>'teams_locked')::boolean then raise exception 'TEAMS_UNLOCKED'; end if;
   if exists(select 1 from public.game_players where room_id=rid and left_at is null and team_id is null) then raise exception 'TEAM_UNASSIGNED'; end if;
   if (select count(distinct team_id) from public.game_players where room_id=rid and left_at is null)<2 then raise exception 'TEAM_EMPTY'; end if;
 end if;
 return public.game_command_phase_three(p_code,p_token_hash,p_action,p_expected_version,p_clue_id,p_board);
end $$;
create or replace function public.competition_command(p_code text,p_token_hash text,p_action text,p_expected_version integer default null,
 p_clue_id uuid default null,p_round_id uuid default null,p_attempt_id uuid default null,p_mode text default null,p_seconds integer default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; rid uuid; pid uuid; b public.game_boards; s public.game_sessions; a public.answer_attempts; points integer; stamp timestamptz;
begin
 -- Authenticate and acquire the same room-row lock used by every game/membership action.
 r:=public.room_command('state',p_code,p_token_hash,null); rid:=(r->>'id')::uuid;
 select * into b from public.game_boards where room_id=rid;
 select * into s from public.game_sessions where room_id=rid;
 if p_action='buzz' then
   if r->'viewer'->>'role'<>'player' then raise exception 'PLAYER_ONLY'; end if;
   pid:=(r->'viewer'->>'player_id')::uuid;
   if r->>'status'<>'in_progress' or s.phase not in ('buzzers_open','rebound_open') or p_clue_id is distinct from s.current_clue_id
      or p_round_id is null or p_round_id is distinct from s.buzz_round_id then raise exception 'BUZZ_CLOSED'; end if;
   if not public.player_can_buzz(rid,s.current_clue_id,pid) then raise exception 'BUZZ_INELIGIBLE'; end if;
   if exists(select 1 from public.answer_attempts where clue_id=s.current_clue_id and player_id=pid) then raise exception 'BUZZ_INELIGIBLE'; end if;
   -- clock_timestamp is evaluated AFTER lock acquisition, not at transaction start.
   stamp:=clock_timestamp();
   insert into public.answer_attempts(room_id,board_id,clue_id,player_id,round_id,accepted_at,deadline,team_id)
    values(rid,b.id,s.current_clue_id,pid,s.buzz_round_id,stamp,stamp+make_interval(secs=>b.answer_seconds),case when b.play_mode='team' then (select team_id from public.game_players where id=pid) else null end) returning * into a;
   update public.game_sessions set phase='player_answering',current_attempt_id=a.id where id=s.id;
 else
   if r->'viewer'->>'role'<>'host' then raise exception 'HOST_ONLY'; end if;
   if p_expected_version is null or p_expected_version<>b.version then raise exception 'STALE_GAME'; end if;
   if p_action='configure' then
     if r->>'status'<>'lobby' then raise exception 'INVALID_TRANSITION'; end if;
     if p_mode is null or p_mode not in ('classic','casual') or p_seconds is null or p_seconds not between 3 and 60 then raise exception 'BAD_REQUEST'; end if;
     update public.game_boards set scoring_mode=p_mode,answer_seconds=p_seconds where id=b.id;
   else
     if r->>'status'<>'in_progress' or p_clue_id is null or p_clue_id is distinct from s.current_clue_id then raise exception 'INVALID_TRANSITION'; end if;
     if p_action='open' then
       if s.phase<>'clue_active' then raise exception 'INVALID_TRANSITION'; end if;
       if not exists(select 1 from public.game_players p where p.room_id=rid and public.player_can_buzz(rid,s.current_clue_id,p.id)) then raise exception 'NO_ELIGIBLE_PLAYERS'; end if;
       update public.game_sessions set phase=case when exists(select 1 from public.answer_attempts where clue_id=s.current_clue_id) then 'rebound_open' else 'buzzers_open' end,
         buzz_round_id=gen_random_uuid(),current_attempt_id=null where id=s.id;
     elsif p_action='close' then
       if s.phase not in ('buzzers_open','rebound_open') then raise exception 'INVALID_TRANSITION'; end if;
       update public.game_sessions set phase='clue_active',buzz_round_id=null where id=s.id;
     elsif p_action in ('correct','incorrect','void') then
       if s.phase not in ('player_answering','answer_judging') or p_attempt_id is null or p_attempt_id is distinct from s.current_attempt_id then raise exception 'INVALID_TRANSITION'; end if;
       select * into a from public.answer_attempts where id=s.current_attempt_id and outcome is null;
       if not found then raise exception 'ALREADY_JUDGED'; end if;
       if p_action='correct' and clock_timestamp()>=a.deadline then raise exception 'ANSWER_EXPIRED'; end if;
       select value into points from public.game_clues where id=s.current_clue_id;
       points:=case when p_action='correct' then points when p_action='incorrect' and b.scoring_mode='classic' then -points else 0 end;
       update public.answer_attempts set outcome=p_action,judged_at=clock_timestamp(),score_delta=points where id=a.id;
       update public.game_players set score=score+points,updated_at=clock_timestamp() where id=a.player_id and b.play_mode='solo';
       if p_action='correct' then
         update public.game_sessions set phase='answer_revealed',buzz_round_id=null where id=s.id;
       elsif p_action='void' then
         -- A void consumes this player's attempt but carries no score penalty.
         update public.game_sessions set phase='clue_active',buzz_round_id=null where id=s.id;
       else
         update public.game_sessions set phase=case when exists(select 1 from public.game_players p where p.room_id=rid and public.player_can_buzz(rid,s.current_clue_id,p.id)) then 'rebound_open' else 'clue_active' end,
           buzz_round_id=gen_random_uuid() where id=s.id;
       end if;
     else raise exception 'BAD_REQUEST'; end if;
   end if;
 end if;
 update public.game_boards set version=version+1,updated_at=clock_timestamp() where id=b.id;
 perform realtime.send(jsonb_build_object('changed',true),'room_changed','room:'||rid::text,true);
 return public.room_command('state',p_code,p_token_hash,null);
end $$;

revoke all on function public.team_snapshot(uuid),public.player_can_buzz(uuid,uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.competition_snapshot(uuid),public.team_command(text,text,text,integer,jsonb),public.game_command(text,text,text,integer,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.competition_snapshot(uuid) from service_role;
grant execute on function public.team_command(text,text,text,integer,jsonb),public.game_command(text,text,text,integer,uuid,jsonb) to service_role;
