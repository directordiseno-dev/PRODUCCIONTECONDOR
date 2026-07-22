-- TECONDOR - Historial de tiempos para tareas y subtareas de produccion.
-- Migracion aditiva: no cambia ni elimina registros existentes.

create table if not exists public.production_work_sessions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.production_tasks(id) on update cascade on delete cascade,
  subtask_id uuid references public.production_subtasks(id) on update cascade on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text,
  started_by text,
  ended_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_work_sessions_valid_range
    check (ended_at is null or ended_at >= started_at)
);

create index if not exists production_work_sessions_task_idx
  on public.production_work_sessions (task_id, started_at);

create index if not exists production_work_sessions_subtask_idx
  on public.production_work_sessions (subtask_id, started_at)
  where subtask_id is not null;

create unique index if not exists production_work_sessions_one_open_task_idx
  on public.production_work_sessions (task_id)
  where subtask_id is null and ended_at is null;

create unique index if not exists production_work_sessions_one_open_subtask_idx
  on public.production_work_sessions (subtask_id)
  where subtask_id is not null and ended_at is null;

alter table public.production_work_sessions enable row level security;

drop policy if exists "production_work_sessions_authenticated_all" on public.production_work_sessions;
create policy "production_work_sessions_authenticated_all"
  on public.production_work_sessions
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.production_work_sessions to authenticated, service_role;
