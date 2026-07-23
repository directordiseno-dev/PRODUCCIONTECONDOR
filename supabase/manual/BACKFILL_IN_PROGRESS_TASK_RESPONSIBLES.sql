-- Completa el responsable de tareas que ya estan en proceso.
-- Solo modifica tareas sin responsable y conserva todas las asignaciones existentes.

begin;

update public.production_tasks
set
  assigned_to = btrim(created_by),
  updated_at = now()
where status = 'en_proceso'
  and nullif(btrim(coalesce(assigned_to, '')), '') is null
  and nullif(btrim(coalesce(created_by, '')), '') is not null
returning
  task_number,
  title,
  created_by,
  assigned_to;

commit;
