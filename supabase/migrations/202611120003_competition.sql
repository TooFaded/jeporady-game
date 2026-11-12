-- Phase 3: apply once after Phase 2. All arbitration uses the existing room lock.
alter table public.game_boards add column scoring_mode text not null default 'classic' check(scoring_mode in ('classic','casual'));
alter table public.game_boards add column answer_seconds integer not null default 10 check(answer_seconds between 3 and 60);
alter table public.game_players add constraint player_room_identity unique(room_id,id);
alter table public.game_sessions drop constraint game_sessions_phase_check;
alter table public.game_sessions drop constraint active_phase_has_clue;
alter table public.game_sessions add constraint game_sessions_phase_check check(phase in ('board','clue_active','buzzers_open','player_answering','answer_judging','rebound_open','answer_revealed','completed'));
alter table public.game_sessions add constraint active_phase_has_clue check((phase not in ('board','completed')) = (current_clue_id is not null));
alter table public.game_sessions add column buzz_round_id uuid;
create table public.answer_attempts (
 id uuid primary key default gen_random_uuid(), room_id uuid not null,
 board_id uuid not null, clue_id uuid not null, player_id uuid not null,
 round_id uuid not null unique, accepted_at timestamptz not null, deadline timestamptz not null,
 outcome text check(outcome in ('correct','incorrect','void')), judged_at timestamptz,
 score_delta integer not null default 0,
 foreign key(room_id,board_id) references public.game_boards(room_id,id) on delete cascade,
 foreign key(board_id,clue_id) references public.game_clues(board_id,id) on delete cascade,
 foreign key(room_id,player_id) references public.game_players(room_id,id) on delete cascade,
 unique(clue_id,player_id), unique(room_id,id),
 check(deadline>accepted_at), check((outcome is null)=(judged_at is null)),
 check((outcome='correct' and score_delta>0) or (outcome='incorrect' and score_delta<=0) or ((outcome is null or outcome='void') and score_delta=0))
);
create unique index one_unjudged_attempt_per_room on public.answer_attempts(room_id) where outcome is null;
create index attempts_leaderboard on public.answer_attempts(room_id,player_id);
alter table public.game_sessions add column current_attempt_id uuid;
alter table public.game_sessions add constraint session_attempt_room foreign key(room_id,current_attempt_id) references public.answer_attempts(room_id,id);
alter table public.answer_attempts enable row level security;
revoke all on public.answer_attempts from anon,authenticated;
grant all on public.answer_attempts to service_role;

create function public.competition_snapshot(p_room_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('scoring_mode',b.scoring_mode,'answer_seconds',b.answer_seconds,'server_time',clock_timestamp(),
 'round_id',s.buzz_round_id,
 'attempt',(select jsonb_build_object('id',a.id,'player_id',a.player_id,'nickname',p.nickname,'deadline',a.deadline,'outcome',a.outcome)
   from public.answer_attempts a join public.game_players p on p.id=a.player_id where a.id=s.current_attempt_id),
 'attempted_player_ids',coalesce((select jsonb_agg(a.player_id) from public.answer_attempts a where a.clue_id=s.current_clue_id),'[]'::jsonb),
 'leaderboard',coalesce((select jsonb_agg(x.entry order by x.score desc,x.joined_at,x.id) from (
   select p.id,p.score,p.joined_at,jsonb_build_object('id',p.id,'nickname',p.nickname,'score',p.score,
     'rank',rank() over(order by p.score desc),
     'correct',(select count(*) from public.answer_attempts a where a.player_id=p.id and a.outcome='correct'),
     'incorrect',(select count(*) from public.answer_attempts a where a.player_id=p.id and a.outcome='incorrect')) entry
   from public.game_players p where p.room_id=p_room_id and (p.left_at is null or exists(select 1 from public.answer_attempts a where a.player_id=p.id))
 ) x),'[]'::jsonb))
 from public.game_boards b left join public.game_sessions s on s.board_id=b.id where b.room_id=p_room_id;
$$;

create or replace function public.game_snapshot(p_room_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.game_boards; s public.game_sessions; active jsonb; categories jsonb;
begin
 select * into b from public.game_boards where room_id=p_room_id;
 if not found then return null; end if;
 select * into s from public.game_sessions where room_id=p_room_id;
 select jsonb_agg(jsonb_build_object('id',c.id,'position',c.position,'name',c.name,'clues',
   (select jsonb_agg(jsonb_build_object('id',q.id,'position',q.position,'value',q.value,'completed',exists(select 1 from public.game_progress p where p.clue_id=q.id)) order by q.position)
    from public.game_clues q where q.category_id=c.id)) order by c.position) into categories
 from public.game_categories c where c.board_id=b.id;
 if s.current_clue_id is not null then
   select jsonb_build_object('id',q.id,'category_id',c.id,'category_name',c.name,'value',q.value,'question',q.question)
     || case when s.phase='answer_revealed' then jsonb_build_object('answer',q.answer) else '{}'::jsonb end into active
   from public.game_clues q join public.game_categories c on c.id=q.category_id where q.id=s.current_clue_id and q.board_id=b.id;
 end if;
 return jsonb_build_object('id',b.id,'version',b.version,'phase',coalesce(s.phase,'lobby'),'categories',categories,'active_clue',active,
   'competition',public.competition_snapshot(p_room_id),'completed_count',(select count(*) from public.game_progress where board_id=b.id),'ended_early',coalesce(s.ended_early,false),
   'participants',case when s.phase='completed' then coalesce((select jsonb_agg(jsonb_build_object('id',id,'nickname',nickname) order by joined_at) from public.game_players where room_id=p_room_id),'[]'::jsonb) else '[]'::jsonb end);
end $$;


-- Expiry is materialized under the room lock on the next authorized read/action.
-- A deadline check in judging also prevents late awards without a background worker.
alter function public.room_command(text,text,text,text) rename to room_command_phase_two;
revoke all on function public.room_command_phase_two(text,text,text,text) from public,anon,authenticated,service_role;
create function public.room_command(p_action text,p_code text,p_token_hash text,p_name text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; rid uuid;
begin
 result:=public.room_command_phase_two(p_action,p_code,p_token_hash,p_name);
 if result is null then return null; end if;
 rid:=(result->>'id')::uuid;
 update public.game_sessions s set phase='answer_judging'
 where s.room_id=rid and s.phase='player_answering' and exists(
   select 1 from public.answer_attempts a where a.id=s.current_attempt_id and a.deadline<=clock_timestamp());
 if found then
   update public.game_boards set version=version+1 where room_id=rid;
   perform realtime.send(jsonb_build_object('changed',true),'room_changed','room:'||rid::text,true);
 end if;
 result:=result||jsonb_build_object('game',public.game_snapshot(rid));
 -- The host needs a private judging reference; player projections never contain it.
 if result->'viewer'->>'role'='host' and result->'game'->'active_clue'->>'id' is not null then
   result:=jsonb_set(result,'{game,host_answer}',to_jsonb((select answer from public.game_clues where id=(result->'game'->'active_clue'->>'id')::uuid)));
 end if;
 return result;
end $$;

-- Retain validated editor/board operations, guarding competitive paths from bypass.
alter function public.game_command(text,text,text,integer,uuid,jsonb) rename to game_command_phase_two;
revoke all on function public.game_command_phase_two(text,text,text,integer,uuid,jsonb) from public,anon,authenticated,service_role;
create function public.game_command(p_code text,p_token_hash text,p_action text,p_expected_version integer default null,p_clue_id uuid default null,p_board jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r jsonb; rid uuid; result jsonb;
begin
 r:=public.room_command('state',p_code,p_token_hash,null); rid:=(r->>'id')::uuid;
 if r->'viewer'->>'role'<>'host' then raise exception 'HOST_ONLY'; end if;
 if p_action='return' and exists(select 1 from public.answer_attempts where clue_id=p_clue_id and room_id=rid) then raise exception 'ROUND_PLAYED'; end if;
 if p_action='end' then
   if p_expected_version is distinct from (r->'game'->>'version')::integer then raise exception 'STALE_GAME'; end if;
   update public.answer_attempts set outcome='void',judged_at=clock_timestamp() where room_id=rid and outcome is null;
 end if;
 result:=public.game_command_phase_two(p_code,p_token_hash,p_action,p_expected_version,p_clue_id,p_board);
 if p_action in ('select','complete','return','end') then
   update public.game_sessions set current_attempt_id=null,buzz_round_id=null where room_id=rid;
   result:=public.room_command('state',p_code,p_token_hash,null);
 end if;
 return result;
end $$;

create function public.competition_command(p_code text,p_token_hash text,p_action text,p_expected_version integer default null,
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
   if not exists(select 1 from public.game_players where id=pid and room_id=rid and left_at is null and is_connected and last_seen_at>clock_timestamp()-interval '45 seconds') then raise exception 'BUZZ_INELIGIBLE'; end if;
   if r->>'status'<>'in_progress' or s.phase not in ('buzzers_open','rebound_open') or p_clue_id is distinct from s.current_clue_id
      or p_round_id is null or p_round_id is distinct from s.buzz_round_id then raise exception 'BUZZ_CLOSED'; end if;
   if exists(select 1 from public.answer_attempts where clue_id=s.current_clue_id and player_id=pid) then raise exception 'BUZZ_INELIGIBLE'; end if;
   -- clock_timestamp is evaluated AFTER lock acquisition, not at transaction start.
   stamp:=clock_timestamp();
   insert into public.answer_attempts(room_id,board_id,clue_id,player_id,round_id,accepted_at,deadline)
    values(rid,b.id,s.current_clue_id,pid,s.buzz_round_id,stamp,stamp+make_interval(secs=>b.answer_seconds)) returning * into a;
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
       if not exists(select 1 from public.game_players p where p.room_id=rid and p.left_at is null and p.is_connected and p.last_seen_at>clock_timestamp()-interval '45 seconds'
         and not exists(select 1 from public.answer_attempts prior where prior.clue_id=s.current_clue_id and prior.player_id=p.id)) then raise exception 'NO_ELIGIBLE_PLAYERS'; end if;
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
       update public.game_players set score=score+points,updated_at=clock_timestamp() where id=a.player_id;
       if p_action='correct' then
         update public.game_sessions set phase='answer_revealed',buzz_round_id=null where id=s.id;
       elsif p_action='void' then
         -- A void consumes this player's attempt but carries no score penalty.
         update public.game_sessions set phase='clue_active',buzz_round_id=null where id=s.id;
       else
         update public.game_sessions set phase=case when exists(select 1 from public.game_players p where p.room_id=rid and p.left_at is null and p.is_connected and p.last_seen_at>clock_timestamp()-interval '45 seconds'
           and not exists(select 1 from public.answer_attempts x where x.clue_id=s.current_clue_id and x.player_id=p.id)) then 'rebound_open' else 'clue_active' end,
           buzz_round_id=gen_random_uuid() where id=s.id;
       end if;
     else raise exception 'BAD_REQUEST'; end if;
   end if;
 end if;
 update public.game_boards set version=version+1,updated_at=clock_timestamp() where id=b.id;
 perform realtime.send(jsonb_build_object('changed',true),'room_changed','room:'||rid::text,true);
 return public.room_command('state',p_code,p_token_hash,null);
end $$;
revoke all on function public.competition_snapshot(uuid) from public,anon,authenticated,service_role;
revoke all on function public.room_command(text,text,text,text),public.game_command(text,text,text,integer,uuid,jsonb),public.competition_command(text,text,text,integer,uuid,uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.room_command(text,text,text,text),public.game_command(text,text,text,integer,uuid,jsonb),public.competition_command(text,text,text,integer,uuid,uuid,uuid,text,integer) to service_role;
