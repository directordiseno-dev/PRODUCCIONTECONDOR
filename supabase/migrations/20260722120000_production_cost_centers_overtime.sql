-- TECONDOR - Centros de costo multiples y horas extra de produccion.
-- Migracion aditiva: conserva las columnas y los registros existentes.

create table if not exists public.production_task_cost_centers (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.production_tasks(id) on update cascade on delete cascade,
  cost_center_code text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (task_id, cost_center_code)
);

create index if not exists production_task_cost_centers_task_idx
  on public.production_task_cost_centers (task_id, position);

create index if not exists production_task_cost_centers_code_idx
  on public.production_task_cost_centers (cost_center_code);

create table if not exists public.production_subtask_cost_centers (
  id uuid primary key default gen_random_uuid(),
  subtask_id uuid not null references public.production_subtasks(id) on update cascade on delete cascade,
  cost_center_code text not null,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  unique (subtask_id, cost_center_code)
);

create index if not exists production_subtask_cost_centers_subtask_idx
  on public.production_subtask_cost_centers (subtask_id, position);

create index if not exists production_subtask_cost_centers_code_idx
  on public.production_subtask_cost_centers (cost_center_code);

create table if not exists public.production_overtime_sessions (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.production_tasks(id) on update cascade on delete cascade,
  subtask_id uuid references public.production_subtasks(id) on update cascade on delete set null,
  started_at timestamptz not null,
  ended_at timestamptz,
  started_by text not null,
  ended_by text,
  end_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_overtime_sessions_valid_range
    check (ended_at is null or ended_at >= started_at)
);

create index if not exists production_overtime_sessions_task_idx
  on public.production_overtime_sessions (task_id, started_at);

create index if not exists production_overtime_sessions_actor_idx
  on public.production_overtime_sessions (started_by, started_at);

create unique index if not exists production_overtime_sessions_one_open_actor_idx
  on public.production_overtime_sessions (started_by)
  where ended_at is null;

insert into public.production_task_cost_centers (task_id, cost_center_code, position)
select id, trim(cost_center_code), 0
from public.production_tasks
where nullif(trim(cost_center_code), '') is not null
on conflict (task_id, cost_center_code) do nothing;

alter table public.production_task_cost_centers enable row level security;
alter table public.production_subtask_cost_centers enable row level security;
alter table public.production_overtime_sessions enable row level security;

drop policy if exists "production_task_cost_centers_authenticated_all" on public.production_task_cost_centers;
create policy "production_task_cost_centers_authenticated_all"
  on public.production_task_cost_centers for all to authenticated
  using (true) with check (true);

drop policy if exists "production_subtask_cost_centers_authenticated_all" on public.production_subtask_cost_centers;
create policy "production_subtask_cost_centers_authenticated_all"
  on public.production_subtask_cost_centers for all to authenticated
  using (true) with check (true);

drop policy if exists "production_overtime_sessions_authenticated_all" on public.production_overtime_sessions;
create policy "production_overtime_sessions_authenticated_all"
  on public.production_overtime_sessions for all to authenticated
  using (true) with check (true);

grant select, insert, update, delete on public.production_task_cost_centers to authenticated, service_role;
grant select, insert, update, delete on public.production_subtask_cost_centers to authenticated, service_role;
grant select, insert, update, delete on public.production_overtime_sessions to authenticated, service_role;
