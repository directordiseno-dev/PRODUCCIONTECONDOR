-- TECONDOR - BORRADO MANUAL DE LA TAREA DE PRUEBA TP-0001
-- Ejecutar UNA SOLA VEZ desde el SQL Editor de Supabase.
--
-- Tarea objetivo:
--   TP-0001 | soldar mezcladora de terrazan | 23 de julio de 2026
--
-- Este script NO toca contabilidad, facturas, ordenes de compra, empleados,
-- proveedores, centros de costo ni movimientos ajenos a esta tarea.

begin;

create temporary table _test_task_to_delete on commit drop as
select id
from public.production_tasks
where task_number = 1
  and lower(trim(title)) = 'soldar mezcladora de terrazan'
  and (created_at at time zone 'America/Bogota')::date = date '2026-07-23';

-- Proteccion: no continua si la tarea no coincide exactamente o si aparecen
-- varias coincidencias inesperadas.
do $$
declare
  matched_tasks integer;
begin
  select count(*) into matched_tasks
  from _test_task_to_delete;

  if matched_tasks <> 1 then
    raise exception
      'Proteccion activada: se esperaba exactamente 1 tarea TP-0001 de prueba y se encontraron %.',
      matched_tasks;
  end if;
end
$$;

create temporary table _test_task_delete_summary on commit drop as
select
  (select count(*) from _test_task_to_delete) as tareas_encontradas,
  (
    select count(*)
    from public.inventory_movements movement
    where movement.production_task_id in (select id from _test_task_to_delete)
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
    where movement.production_task_id in (select id from _test_task_to_delete)
  ) as cantidad_neta_devuelta_al_inventario;

-- Revierte solamente el efecto de los movimientos ligados a TP-0001.
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
  where movement.production_task_id in (select id from _test_task_to_delete)
  group by movement.item_id
)
update public.inventory_items item
set
  stock = coalesce(item.stock, 0) + reversal.stock_to_restore,
  updated_at = now()
from inventory_reversal reversal
where item.id = reversal.item_id
  and reversal.stock_to_restore <> 0;

delete from public.production_overtime_sessions
where task_id in (select id from _test_task_to_delete);

delete from public.production_work_sessions
where task_id in (select id from _test_task_to_delete);

delete from public.production_task_materials
where task_id in (select id from _test_task_to_delete);

delete from public.inventory_movements
where production_task_id in (select id from _test_task_to_delete);

delete from public.production_task_events
where task_id in (select id from _test_task_to_delete);

delete from public.production_task_cost_centers
where task_id in (select id from _test_task_to_delete);

delete from public.production_subtask_cost_centers
where subtask_id in (
  select id from public.production_subtasks
  where task_id in (select id from _test_task_to_delete)
);

delete from public.production_subtask_assignments
where subtask_id in (
  select id from public.production_subtasks
  where task_id in (select id from _test_task_to_delete)
);

delete from public.production_task_attachments
where task_id in (select id from _test_task_to_delete);

delete from public.production_subtasks
where task_id in (select id from _test_task_to_delete);

delete from public.production_tasks
where id in (select id from _test_task_to_delete);

select
  summary.tareas_encontradas as tareas_eliminadas,
  summary.movimientos_inventario_encontrados as movimientos_eliminados,
  summary.cantidad_neta_devuelta_al_inventario,
  (select count(*) from public.production_tasks) as tareas_restantes,
  'El consecutivo no fue modificado'::text as consecutivo
from _test_task_delete_summary summary;

commit;
