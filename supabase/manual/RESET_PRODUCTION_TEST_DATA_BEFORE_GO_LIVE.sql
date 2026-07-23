-- TECONDOR - LIMPIEZA MANUAL DE PRUEBAS DEL MODULO DE PRODUCCION
-- Ejecutar UNA SOLA VEZ desde el SQL Editor de Supabase antes de iniciar operacion real.
--
-- ALCANCE LIMITADO:
--   SI elimina tareas de produccion, subtareas, tiempos, eventos, adjuntos,
--   horas extra, consumos asociados y movimientos ligados a esas tareas.
--   SI devuelve al inventario las cantidades descontadas por esos movimientos.
--   SI reinicia el consecutivo de production_tasks.task_number en 1.
--
-- NO toca contabilidad, facturas, ordenes de compra, proveedores, empleados,
-- centros de costo, items de inventario ni movimientos ajenos a Produccion.

begin;

-- Congela el conjunto exacto que se va a limpiar. Incluye tareas visibles,
-- terminadas y canceladas de las pruebas anteriores.
create temporary table _production_reset_task_ids on commit drop as
select id
from public.production_tasks;

create temporary table _production_reset_summary on commit drop as
select
  (select count(*) from _production_reset_task_ids) as tareas_encontradas,
  (
    select count(*)
    from public.inventory_movements movement
    where movement.production_task_id in (select id from _production_reset_task_ids)
  ) as movimientos_inventario_encontrados,
  (
    select coalesce(sum(
      case
        when movement.movement_type = 'salida' then movement.quantity
        when movement.movement_type = 'entrada' then -movement.quantity
        when movement.movement_type = 'ajuste' then -movement.quantity
        else 0
      end
    ), 0)
    from public.inventory_movements movement
    where movement.production_task_id in (select id from _production_reset_task_ids)
  ) as cantidad_neta_devuelta_al_inventario;

-- Revierte el efecto de los movimientos de prueba sobre las existencias.
with inventory_reversal as (
  select
    movement.item_id,
    sum(
      case
        when movement.movement_type = 'salida' then movement.quantity
        when movement.movement_type = 'entrada' then -movement.quantity
        when movement.movement_type = 'ajuste' then -movement.quantity
        else 0
      end
    ) as stock_to_restore
  from public.inventory_movements movement
  where movement.production_task_id in (select id from _production_reset_task_ids)
  group by movement.item_id
)
update public.inventory_items item
set
  stock = coalesce(item.stock, 0) + reversal.stock_to_restore,
  updated_at = now()
from inventory_reversal reversal
where item.id = reversal.item_id
  and reversal.stock_to_restore <> 0;

-- Borra primero las relaciones directas; las relaciones de subtareas tambien
-- tienen cascada, pero se dejan explicitas para que el alcance sea auditable.
delete from public.production_overtime_sessions
where task_id in (select id from _production_reset_task_ids);

delete from public.production_work_sessions
where task_id in (select id from _production_reset_task_ids);

delete from public.production_task_materials
where task_id in (select id from _production_reset_task_ids);

delete from public.inventory_movements
where production_task_id in (select id from _production_reset_task_ids);

delete from public.production_task_events
where task_id in (select id from _production_reset_task_ids);

delete from public.production_task_cost_centers
where task_id in (select id from _production_reset_task_ids);

delete from public.production_subtask_cost_centers
where subtask_id in (
  select id from public.production_subtasks
  where task_id in (select id from _production_reset_task_ids)
);

delete from public.production_subtask_assignments
where subtask_id in (
  select id from public.production_subtasks
  where task_id in (select id from _production_reset_task_ids)
);

delete from public.production_task_attachments
where task_id in (select id from _production_reset_task_ids);

delete from public.production_subtasks
where task_id in (select id from _production_reset_task_ids);

delete from public.production_tasks
where id in (select id from _production_reset_task_ids);

-- Los registros de adjuntos ya se eliminaron arriba. Supabase protege los
-- archivos fisicos de Storage contra borrado directo por SQL; por eso no se
-- toca storage.objects aqui. Los archivos de prueba quedan sin referencia y
-- pueden borrarse luego desde Storage > production-task-attachments.

-- Funciona tanto si task_number usa SERIAL como si usa IDENTITY.
do $$
declare
  task_number_sequence text;
begin
  task_number_sequence := pg_get_serial_sequence('public.production_tasks', 'task_number');

  if task_number_sequence is null
     and to_regclass('public.production_tasks_task_number_seq') is not null then
    task_number_sequence := 'public.production_tasks_task_number_seq';
  end if;

  if task_number_sequence is not null then
    execute format('select setval(%L, 1, false)', task_number_sequence);
  end if;
end
$$;

-- Resultado esperado: tareas_restantes = 0 y siguiente_tarea = TP-0001.
select
  summary.tareas_encontradas as tareas_eliminadas,
  summary.movimientos_inventario_encontrados as movimientos_eliminados,
  summary.cantidad_neta_devuelta_al_inventario,
  (select count(*) from public.production_tasks) as tareas_restantes,
  'TP-0001'::text as siguiente_tarea
from _production_reset_summary summary;

commit;
