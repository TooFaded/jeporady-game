-- Phase 2. Apply after 202611120001_phase_one.sql. No browser table access.
create table public.game_boards (
 id uuid primary key default gen_random_uuid(), room_id uuid not null unique references public.game_rooms on delete cascade,
 version integer not null default 0 check(version>=0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(room_id,id)
);
create table public.game_categories (
 id uuid primary key default gen_random_uuid(), board_id uuid not null references public.game_boards on delete cascade,
 position integer not null check(position between 0 and 4), name text not null check(char_length(btrim(name)) between 1 and 40),
 unique(board_id,position), unique(board_id,id)
);
create table public.game_clues (
 id uuid primary key default gen_random_uuid(), board_id uuid not null references public.game_boards on delete cascade,
 category_id uuid not null, position integer not null check(position between 0 and 4),
 value integer generated always as ((position+1)*200) stored,
 question text not null check(char_length(btrim(question)) between 1 and 1000),
 answer text not null check(char_length(btrim(answer)) between 1 and 300),
 foreign key(board_id,category_id) references public.game_categories(board_id,id) on delete cascade,
 unique(category_id,position), unique(board_id,id)
);
-- Completion is stored once, here; tile.completed is derived from this row.
create table public.game_progress (
 board_id uuid not null references public.game_boards on delete cascade,
 clue_id uuid primary key, completed_at timestamptz not null default now(),
 foreign key(board_id,clue_id) references public.game_clues(board_id,id) on delete cascade
);
create index progress_board on public.game_progress(board_id);
create index clues_board on public.game_clues(board_id);
alter table public.game_sessions add column board_id uuid;
alter table public.game_sessions add column phase text not null default 'board' check(phase in ('board','clue_active','answer_revealed','completed'));
alter table public.game_sessions add column ended_early boolean not null default false;
alter table public.game_sessions add constraint session_room_board foreign key(room_id,board_id) references public.game_boards(room_id,id);
alter table public.game_sessions add constraint session_active_clue foreign key(board_id,current_clue_id) references public.game_clues(board_id,id);
alter table public.game_sessions add constraint active_phase_has_clue check((phase in ('clue_active','answer_revealed')) = (current_clue_id is not null));
alter table public.game_boards enable row level security;
alter table public.game_categories enable row level security;
alter table public.game_clues enable row level security;
alter table public.game_progress enable row level security;
revoke all on public.game_boards,public.game_categories,public.game_clues,public.game_progress from anon,authenticated;
grant all on public.game_boards,public.game_categories,public.game_clues,public.game_progress to service_role;

-- Seed content is database-only, never imported into a client bundle.
create function public.sample_game_board() returns jsonb language sql immutable set search_path='' as $fn$
select $sample${"categories": [{"position": 0, "name": "History", "clues": [{"position": 0, "question": "In what year did King John seal the original Magna Carta at Runnymede?", "answer": "1215"}, {"position": 1, "question": "Which civilization built Machu Picchu in the fifteenth century?", "answer": "The Inca civilization"}, {"position": 2, "question": "Which empire captured Constantinople in 1453?", "answer": "The Ottoman Empire"}, {"position": 3, "question": "Alongside hieroglyphic and demotic scripts, which language appears on the Rosetta Stone?", "answer": "Ancient Greek"}, {"position": 4, "question": "Which city served as the first U.S. capital under the Constitution, beginning in 1789?", "answer": "New York City"}]}, {"position": 1, "name": "Science", "clues": [{"position": 0, "question": "Titan, a moon with a dense atmosphere, orbits which planet?", "answer": "Saturn"}, {"position": 1, "question": "Which chemical element has the symbol W?", "answer": "Tungsten"}, {"position": 2, "question": "Which organelles generate most of the ATP used by a typical animal cell?", "answer": "Mitochondria"}, {"position": 3, "question": "An element's atomic number equals the number of which particles in its nucleus?", "answer": "Protons"}, {"position": 4, "question": "What is the SI base unit of luminous intensity?", "answer": "The candela"}]}, {"position": 2, "name": "Movies", "clues": [{"position": 0, "question": "Who directed the animated film Spirited Away?", "answer": "Hayao Miyazaki"}, {"position": 1, "question": "Which South Korean film became the first non-English-language movie to win the Oscar for Best Picture?", "answer": "Parasite"}, {"position": 2, "question": "In which European city is the 1949 film The Third Man set?", "answer": "Vienna"}, {"position": 3, "question": "Who directed the 1954 film Seven Samurai?", "answer": "Akira Kurosawa"}, {"position": 4, "question": "What was the title of Disney's first full-length animated feature, released in 1937?", "answer": "Snow White and the Seven Dwarfs"}]}, {"position": 3, "name": "Sports", "clues": [{"position": 0, "question": "How many events make up an athletics decathlon?", "answer": "Ten"}, {"position": 1, "question": "What is the feathered or synthetic projectile hit over the net in badminton called?", "answer": "A shuttlecock"}, {"position": 2, "question": "In tennis scoring, what word denotes a score of zero?", "answer": "Love"}, {"position": 3, "question": "What color jersey identifies the overall general-classification leader in the Tour de France?", "answer": "Yellow"}, {"position": 4, "question": "Which city hosted the first modern Olympic Games in 1896?", "answer": "Athens"}]}, {"position": 4, "name": "Random Trivia", "clues": [{"position": 0, "question": "What is the name of Japan's national currency?", "answer": "The yen"}, {"position": 1, "question": "What is the world's largest hot desert?", "answer": "The Sahara"}, {"position": 2, "question": "Which chess piece moves any unobstructed distance diagonally, but never horizontally or vertically?", "answer": "The bishop"}, {"position": 3, "question": "How many dot positions are in a standard literary braille cell?", "answer": "Six"}, {"position": 4, "question": "What Japanese term names the art of folding paper into decorative shapes?", "answer": "Origami"}]}]}$sample$::jsonb;
$fn$;

-- Caller holds the room row lock; supports both new and pre-Phase-2 rooms.
create function public.ensure_game_board(p_room_id uuid) returns uuid
language plpgsql security definer set search_path='' as $$
declare board uuid; category uuid; cat jsonb; clue jsonb;
begin
 select id into board from public.game_boards where room_id=p_room_id;
 if found then return board; end if;
 insert into public.game_boards(room_id) values(p_room_id) returning id into board;
 for cat in select value from jsonb_array_elements(public.sample_game_board()->'categories') loop
   insert into public.game_categories(board_id,position,name) values(board,(cat->>'position')::integer,cat->>'name') returning id into category;
   for clue in select value from jsonb_array_elements(cat->'clues') loop
     insert into public.game_clues(board_id,category_id,position,question,answer) values(board,category,(clue->>'position')::integer,clue->>'question',clue->>'answer');
   end loop;
 end loop;
 update public.game_sessions set board_id=board where room_id=p_room_id and board_id is null;
 return board;
end $$;

-- Safe projection: all tiles, but only the active question; its answer is added
-- only in answer_revealed. This same projection is used for hosts and players.
create function public.game_snapshot(p_room_id uuid) returns jsonb
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
 if s.phase in ('clue_active','answer_revealed') then
   select jsonb_build_object('id',q.id,'category_id',c.id,'category_name',c.name,'value',q.value,'question',q.question)
     || case when s.phase='answer_revealed' then jsonb_build_object('answer',q.answer) else '{}'::jsonb end into active
   from public.game_clues q join public.game_categories c on c.id=q.category_id where q.id=s.current_clue_id and q.board_id=b.id;
 end if;
 return jsonb_build_object('id',b.id,'version',b.version,'phase',coalesce(s.phase,'lobby'),'categories',categories,'active_clue',active,
   'completed_count',(select count(*) from public.game_progress where board_id=b.id),'ended_early',coalesce(s.ended_early,false),
   'participants',case when s.phase='completed' then coalesce((select jsonb_agg(jsonb_build_object('id',id,'nickname',nickname) order by joined_at) from public.game_players where room_id=p_room_id),'[]'::jsonb) else '[]'::jsonb end);
end $$;

-- Keep Phase 1 membership logic intact. Revoke direct access to the internal
-- implementation so the original start path cannot bypass guarded gameplay.
alter function public.room_command(text,text,text,text) rename to room_command_phase_one;
revoke all on function public.room_command_phase_one(text,text,text,text) from public,anon,authenticated,service_role;
create function public.room_command(p_action text,p_code text,p_token_hash text,p_name text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; rid uuid;
begin
 if p_action='start' then
   result:=public.room_command_phase_one('state',p_code,p_token_hash,null);
   if result->'viewer'->>'role'<>'host' then raise exception 'HOST_ONLY'; end if;
   raise exception 'VERSION_REQUIRED';
 end if;
 if p_action='leave' then
   result:=public.room_command_phase_one('state',p_code,p_token_hash,null);
   -- Completed games remain recoverable by other participants after host leaves.
   if result->>'status'='completed' and result->'viewer'->>'role'='host' then
     update public.room_credentials set revoked_at=now() where id=(result->'viewer'->>'id')::uuid;
     perform realtime.send(jsonb_build_object('changed',true),'room_changed','room:'||(result->>'id'),true);
     return null;
   end if;
 end if;
 result:=public.room_command_phase_one(p_action,p_code,p_token_hash,p_name);
 if result is null then return null; end if;
 rid:=(result->>'id')::uuid;
 perform public.ensure_game_board(rid);
 return result||jsonb_build_object('game',public.game_snapshot(rid));
end $$;

create function public.game_command(p_code text,p_token_hash text,p_action text,p_expected_version integer default null,p_clue_id uuid default null,p_board jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare room jsonb; rid uuid; b public.game_boards; s public.game_sessions; cat jsonb; clue jsonb; editor jsonb;
begin
 -- Authorization also takes the shared room-row lock, serializing every mutation
 -- with joins/leaves and snapshot reads across serverless processes.
 room:=public.room_command('state',p_code,p_token_hash,null);
 if room->'viewer'->>'role'<>'host' then raise exception 'HOST_ONLY'; end if;
 rid:=(room->>'id')::uuid;
 select * into b from public.game_boards where room_id=rid;
 select * into s from public.game_sessions where room_id=rid;
 if p_action='editor' then
   if room->>'status'<>'lobby' then raise exception 'INVALID_TRANSITION'; end if;
   select jsonb_build_object('id',b.id,'version',b.version,'categories',jsonb_agg(jsonb_build_object('id',c.id,'position',c.position,'name',c.name,'clues',
     (select jsonb_agg(jsonb_build_object('id',q.id,'position',q.position,'question',q.question,'answer',q.answer) order by q.position) from public.game_clues q where q.category_id=c.id)) order by c.position)) into editor
     from public.game_categories c where c.board_id=b.id;
   return editor;
 end if;
 if p_action not in ('save','start','select','reveal','complete','return','end') then raise exception 'BAD_REQUEST'; end if;
 if p_expected_version is null then raise exception 'VERSION_REQUIRED'; end if;
 if p_expected_version<>b.version then raise exception 'STALE_GAME'; end if;
 if p_action='save' then
   if room->>'status'<>'lobby' then raise exception 'INVALID_TRANSITION'; end if;
   if jsonb_typeof(p_board->'categories') is distinct from 'array' then raise exception 'INVALID_BOARD'; end if;
   if jsonb_array_length(p_board->'categories')<>5 then raise exception 'INVALID_BOARD'; end if;
   if (select count(distinct lower(btrim(value->>'name'))) from jsonb_array_elements(p_board->'categories'))<>5
      or (select count(distinct value->>'id') from jsonb_array_elements(p_board->'categories'))<>5 then raise exception 'INVALID_BOARD'; end if;
   for cat in select value from jsonb_array_elements(p_board->'categories') loop
     if jsonb_typeof(cat->'name') is distinct from 'string' or char_length(btrim(cat->>'name')) not between 1 and 40
       or not exists(select 1 from public.game_categories where board_id=b.id and id::text=cat->>'id' and position::text=cat->>'position') then raise exception 'INVALID_BOARD'; end if;
     if jsonb_typeof(cat->'clues') is distinct from 'array' then raise exception 'INVALID_BOARD'; end if;
     if jsonb_array_length(cat->'clues')<>5 or (select count(distinct value->>'id') from jsonb_array_elements(cat->'clues'))<>5 then raise exception 'INVALID_BOARD'; end if;
     update public.game_categories set name=btrim(cat->>'name') where id::text=cat->>'id';
     for clue in select value from jsonb_array_elements(cat->'clues') loop
       if jsonb_typeof(clue->'question') is distinct from 'string' or jsonb_typeof(clue->'answer') is distinct from 'string'
         or char_length(btrim(clue->>'question')) not between 1 and 1000 or char_length(btrim(clue->>'answer')) not between 1 and 300
         or not exists(select 1 from public.game_clues where board_id=b.id and category_id::text=cat->>'id' and id::text=clue->>'id' and position::text=clue->>'position') then raise exception 'INVALID_BOARD'; end if;
       update public.game_clues set question=btrim(clue->>'question'),answer=btrim(clue->>'answer') where id::text=clue->>'id';
     end loop;
   end loop;
 elsif p_action='start' then
   if room->>'status'<>'lobby' or s.id is not null then raise exception 'INVALID_TRANSITION'; end if;
   if (select count(*) from public.game_categories where board_id=b.id)<>5 or (select count(*) from public.game_clues where board_id=b.id)<>25
     or exists(select 1 from public.game_clues where board_id=b.id and (btrim(question)='' or btrim(answer)='')) then raise exception 'INVALID_BOARD'; end if;
   if not exists(select 1 from public.game_players where room_id=rid and left_at is null and is_connected and last_seen_at>now()-interval '45 seconds') then raise exception 'EMPTY_ROOM'; end if;
   insert into public.game_sessions(room_id,board_id,phase) values(rid,b.id,'board');
   update public.game_rooms set status='in_progress',updated_at=now() where id=rid;
 else
   if room->>'status'<>'in_progress' or s.id is null then raise exception 'INVALID_TRANSITION'; end if;
   if p_action='select' then
     if s.phase<>'board' then raise exception 'INVALID_TRANSITION'; end if;
     if p_clue_id is null or not exists(select 1 from public.game_clues where board_id=b.id and id=p_clue_id) then raise exception 'CLUE_UNAVAILABLE'; end if;
     if exists(select 1 from public.game_progress where clue_id=p_clue_id) then raise exception 'CLUE_UNAVAILABLE'; end if;
     update public.game_sessions set current_clue_id=p_clue_id,phase='clue_active' where id=s.id;
   elsif p_action='end' then
     update public.game_sessions set phase='completed',current_clue_id=null,finished_at=now(),ended_early=true where id=s.id;
     update public.game_rooms set status='completed',updated_at=now() where id=rid;
   else
     if p_clue_id is null or p_clue_id is distinct from s.current_clue_id then raise exception 'CLUE_UNAVAILABLE'; end if;
     if p_action='reveal' then
       if s.phase<>'clue_active' then raise exception 'INVALID_TRANSITION'; end if;
       update public.game_sessions set phase='answer_revealed' where id=s.id;
     elsif p_action='return' then
       if s.phase<>'clue_active' then raise exception 'INVALID_TRANSITION'; end if;
       update public.game_sessions set phase='board',current_clue_id=null where id=s.id;
     elsif p_action='complete' then
       if s.phase<>'answer_revealed' then raise exception 'INVALID_TRANSITION'; end if;
       insert into public.game_progress(board_id,clue_id) values(b.id,s.current_clue_id);
       if (select count(*) from public.game_progress where board_id=b.id)=25 then
         update public.game_sessions set phase='completed',current_clue_id=null,finished_at=now() where id=s.id;
         update public.game_rooms set status='completed',updated_at=now() where id=rid;
       else
         update public.game_sessions set phase='board',current_clue_id=null where id=s.id;
       end if;
     end if;
   end if;
 end if;
 update public.game_boards set version=version+1,updated_at=now() where id=b.id;
 -- Supabase Broadcast carries only an invalidation, never question/answer keys.
 -- realtime.send inserts transactionally: clients only observe committed changes.
 perform realtime.send(jsonb_build_object('changed',true),'room_changed','room:'||rid::text,true);
 return public.room_command('state',p_code,p_token_hash,null);
end $$;

-- Ended games stay readable/subscribable until room expiry or explicit leave.
create or replace function public.can_access_room_topic(topic text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.room_credentials c join public.game_rooms r on r.id=c.room_id
   where c.id::text=(auth.jwt()->>'session_id') and c.room_id::text=(auth.jwt()->>'room_id')
   and topic='room:'||r.id::text and c.revoked_at is null and r.expires_at>now() and r.status in ('lobby','in_progress','completed'));
$$;
revoke all on function public.sample_game_board(),public.ensure_game_board(uuid),public.game_snapshot(uuid) from public,anon,authenticated,service_role;
revoke all on function public.room_command(text,text,text,text),public.game_command(text,text,text,integer,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.room_command(text,text,text,text),public.game_command(text,text,text,integer,uuid,jsonb) to service_role;
