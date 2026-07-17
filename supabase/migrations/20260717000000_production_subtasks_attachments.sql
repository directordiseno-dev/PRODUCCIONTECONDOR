-- TECONDOR - Subtareas, responsables multiples y adjuntos de produccion.

create table if not exists public.production_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.production_tasks(id) on update cascade on delete cascade,
  position integer not null default 0,
  title text not null,
  notes text,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'en_proceso', 'pausada', 'terminada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists production_subtasks_task_idx
  on public.production_subtasks (task_id, position);

create table if not exists public.production_subtask_assignments (
  id uuid primary key default gen_random_uuid(),
  subtask_id uuid not null references public.production_subtasks(id) on update cascade on delete cascade,
  employee_id text not null,
  employee_name text not null,
  created_at timestamptz not null default now(),
  unique (subtask_id, employee_id)
);

create index if not exists production_subtask_assignments_subtask_idx
  on public.production_subtask_assignments (subtask_id);

create index if not exists production_subtask_assignments_employee_idx
  on public.production_subtask_assignments (employee_id);

create table if not exists public.production_task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.production_tasks(id) on update cascade on delete cascade,
  subtask_id uuid references public.production_subtasks(id) on update cascade on delete cascade,
  bucket_path text not null unique,
  file_name text not null,
  content_type text,
  size_bytes bigint not null default 0,
  uploaded_by text,
  created_at timestamptz not null default now()
);

create index if not exists production_task_attachments_task_idx
  on public.production_task_attachments (task_id, created_at);

create index if not exists production_task_attachments_subtask_idx
  on public.production_task_attachments (subtask_id, created_at)
  where subtask_id is not null;

alter table public.production_subtasks enable row level security;
alter table public.production_subtask_assignments enable row level security;
alter table public.production_task_attachments enable row level security;

drop policy if exists "production_subtasks_authenticated_all" on public.production_subtasks;
create policy "production_subtasks_authenticated_all"
  on public.production_subtasks
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "production_subtask_assignments_authenticated_all" on public.production_subtask_assignments;
create policy "production_subtask_assignments_authenticated_all"
  on public.production_subtask_assignments
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "production_task_attachments_authenticated_all" on public.production_task_attachments;
create policy "production_task_attachments_authenticated_all"
  on public.production_task_attachments
  for all
  to authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.production_subtasks to authenticated, service_role;
grant select, insert, update, delete on public.production_subtask_assignments to authenticated, service_role;
grant select, insert, update, delete on public.production_task_attachments to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit)
values ('production-task-attachments', 'production-task-attachments', false, 8388608)
on conflict (id) do update
set public = false,
    file_size_limit = 8388608;

drop policy if exists "production_attachments_authenticated_read" on storage.objects;
create policy "production_attachments_authenticated_read"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'production-task-attachments');

drop policy if exists "production_attachments_owner_insert" on storage.objects;
create policy "production_attachments_owner_insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'production-task-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "production_attachments_owner_update" on storage.objects;
create policy "production_attachments_owner_update"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'production-task-attachments'
    and owner_id = auth.uid()::text
  )
  with check (
    bucket_id = 'production-task-attachments'
    and owner_id = auth.uid()::text
  );

drop policy if exists "production_attachments_owner_delete" on storage.objects;
create policy "production_attachments_owner_delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'production-task-attachments'
    and owner_id = auth.uid()::text
  );
