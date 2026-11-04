-- Ironmind: banco de dados no Supabase.
-- Cole tudo isto em Supabase > SQL Editor > New query e clique em Run (uma vez só).

-- Documentos do app (treinos, planos, liga, desafios, feed, curtidas, clubes)
create table if not exists public.docs (
  col        text not null,          -- coleção: "data/users/<id>" (privado) ou liga, desafios, feed, curtidas, clubes
  id         text not null,          -- id do documento
  owner      uuid not null references auth.users(id) on delete cascade,
  data       jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
create index if not exists docs_owner_idx on public.docs(owner);

-- Nome de cada pessoa (aparece na Liga, no feed e no clube)
create table if not exists public.profiles (
  id   uuid primary key references auth.users(id) on delete cascade,
  name text not null default 'Atleta'
);

alter table public.docs enable row level security;
alter table public.profiles enable row level security;

-- Coleções que os amigos podem ver
create or replace function public.is_shared_col(c text) returns boolean
language sql immutable as $$ select c in ('liga','desafios','feed','curtidas','clubes') $$;

-- Ler: seus próprios dados, ou os dados compartilhados (liga etc.) de quem está logado
drop policy if exists docs_read on public.docs;
create policy docs_read on public.docs for select to authenticated
  using (owner = auth.uid() or public.is_shared_col(col));

-- Escrever: só nos seus dados privados, ou no SEU documento das coleções compartilhadas
drop policy if exists docs_insert on public.docs;
create policy docs_insert on public.docs for insert to authenticated
  with check (owner = auth.uid() and (col = 'data/users/' || auth.uid()::text or (public.is_shared_col(col) and id = auth.uid()::text)));

drop policy if exists docs_update on public.docs;
create policy docs_update on public.docs for update to authenticated
  using (owner = auth.uid())
  with check (owner = auth.uid() and (col = 'data/users/' || auth.uid()::text or (public.is_shared_col(col) and id = auth.uid()::text)));

drop policy if exists docs_delete on public.docs;
create policy docs_delete on public.docs for delete to authenticated
  using (owner = auth.uid());

-- Perfis: todos logados veem os nomes; cada um só edita o seu
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_write on public.profiles;
create policy profiles_write on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- Atualização em tempo real da Liga, desafios, feed e clube
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
