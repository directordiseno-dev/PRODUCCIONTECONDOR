"use client";

import type { FormEvent } from "react";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  consumeProductionMaterial,
  createInventoryItem,
  createInventoryMovement,
  createProductionTask,
  updateProductionTaskStatus,
} from "@/app/actions/produccion";
import { formatCOP, formatDateShort, formatQuantity } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import type {
  CostCenterOption,
  InventoryItem,
  InventoryMovement,
  InventoryMovementType,
  ProductionEmployeeOption,
  ProductionTask,
  ProductionTaskPriority,
  ProductionTaskStatus,
  ProductionWorkspaceData,
  Supplier,
} from "@/lib/types";

type Tab = "inicio" | "inventario" | "tareas" | "consumos";
type Feedback = { type: "success" | "error" | "info"; text: string } | null;

const tabs: Array<{ id: Tab; label: string; detail: string }> = [
  { id: "inicio", label: "Inicio planta", detail: "Tareas activas, alertas y movimientos recientes" },
  { id: "inventario", label: "Inventario", detail: "Items, stock y entradas manuales" },
  { id: "tareas", label: "Tareas", detail: "Soldadura, ensamble, pintura, lavado y revision" },
  { id: "consumos", label: "Consumos", detail: "Material usado por tarea y centro de costo" },
];

const processOptions = [
  "Soldadura",
  "Ensamble",
  "Revision de piezas",
  "Pulido",
  "Lavado",
  "Pintura aerosol",
  "Pintura compresor",
  "Ensamble maquina",
  "Corte de perfiles",
  "Separar y embalar",
  "Otro",
];

const priorityLabels: Record<ProductionTaskPriority, string> = {
  baja: "Baja",
  media: "Media",
  alta: "Alta",
  urgente: "Urgente",
};

const statusLabels: Record<ProductionTaskStatus, string> = {
  pendiente: "Pendiente",
  en_proceso: "En proceso",
  pausada: "Pausada",
  bloqueada: "Bloqueada",
  terminada: "Terminada",
  revisada: "Revisada",
  cancelada: "Cancelada",
};

export function ProductionWorkspace({ data }: { data: ProductionWorkspaceData }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("inicio");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();

  const metrics = useMemo(() => buildMetrics(data.items, data.tasks, data.movements), [data.items, data.tasks, data.movements]);
  const visibleTasks = data.tasks.filter((task) => task.status !== "cancelada").slice(0, 80);
  const activeTasks = visibleTasks.filter((task) => !["terminada", "revisada"].includes(task.status));
  const lowStockItems = data.items.filter((item) => item.active && item.min_stock > 0 && item.stock <= item.min_stock);

  function runAction(label: string, action: () => Promise<unknown>, success = "Listo. Cambios guardados.") {
    startTransition(async () => {
      setFeedback({ type: "info", text: label });
      try {
        await action();
        setFeedback({ type: "success", text: success });
        router.refresh();
      } catch (error) {
        setFeedback({ type: "error", text: error instanceof Error ? error.message : "No se pudo completar la accion." });
      }
    });
  }

  if (!data.schemaReady) {
    return <ProductionSchemaNotice message={data.message} />;
  }

  return (
    <div className="production-workspace space-y-5">
      <section className="overflow-hidden rounded-2xl border border-white/80 bg-white/95 shadow-[0_22px_70px_rgba(15,23,42,0.09)]">
        <div className="grid gap-5 border-b border-neutral-100 bg-gradient-to-br from-white via-white to-slate-50 p-5 lg:grid-cols-[1.25fr_1fr] lg:items-end">
          <div className="min-w-0">
            <div className="inline-flex rounded-full border border-tecondor-magenta/15 bg-tecondor-magenta/5 px-3 py-1 text-[11px] font-black uppercase tracking-wide text-tecondor-magenta">
              Planta TECONDOR
            </div>
            <h1 className="mt-3 text-3xl font-black leading-tight text-neutral-950">Produccion e inventario</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-500">
              Tareas de planta, consumo de materiales y trazabilidad por centro de costo sin depender de una O.C. especifica.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="btn-primary h-10 px-4 text-sm" onClick={() => setActiveTab("tareas")}>
                Nueva tarea
              </button>
              <button type="button" className="btn-secondary h-10 px-4 text-sm" onClick={() => setActiveTab("consumos")}>
                Registrar consumo
              </button>
              <button type="button" className="btn-secondary h-10 px-4 text-sm" onClick={() => setActiveTab("inventario")}>
                Inventario
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Tareas activas" value={String(metrics.activeTasks)} detail={`${metrics.inProcessTasks} en proceso`} tone="magenta" />
            <Metric label="Stock critico" value={String(metrics.lowStock)} detail="items bajo minimo" tone="amber" />
            <Metric label="Valor stock" value={formatCOP(metrics.stockValue)} detail={`${data.items.length} items`} tone="green" />
            <Metric label="Consumo mes" value={formatCOP(metrics.monthConsumption)} detail="salidas de inventario" tone="sky" />
          </div>
        </div>

        <div className="production-tabs">
          <div className="production-tabs__grid rounded-xl bg-neutral-100/70 p-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "rounded-lg transition",
                  activeTab === tab.id
                    ? "bg-white text-neutral-950 shadow-sm ring-1 ring-white"
                    : "text-neutral-600 hover:bg-white/70",
                )}
              >
                <span className="block text-sm font-bold">{tab.label}</span>
                <span className="mt-1 hidden text-xs text-neutral-500 sm:block">{tab.detail}</span>
              </button>
            ))}
          </div>
        </div>

        {feedback ? (
          <div
            className={cn(
              "mx-5 mt-4 rounded-md border px-4 py-3 text-sm",
              feedback.type === "success" && "border-emerald-200 bg-emerald-50 text-emerald-800",
              feedback.type === "error" && "border-red-200 bg-red-50 text-red-700",
              feedback.type === "info" && "border-sky-200 bg-sky-50 text-sky-800",
            )}
          >
            {feedback.text}
          </div>
        ) : null}

        <div className="p-3 sm:p-5">
          {activeTab === "inicio" ? (
            <ProductionHome
              tasks={activeTasks}
              lowStockItems={lowStockItems}
              movements={data.movements}
              pending={isPending}
              onOpenTab={setActiveTab}
              onStatus={(task, status) => runAction("Actualizando tarea...", () => updateProductionTaskStatus(task.id, status), "Tarea actualizada.")}
            />
          ) : null}

          {activeTab === "inventario" ? (
            <InventoryTab
              items={data.items}
              suppliers={data.suppliers}
              costCenters={data.cost_centers}
              pending={isPending}
              onCreateItem={(form) => runAction("Creando item de inventario...", () => createInventoryItem(form), "Item creado.")}
              onMovement={(form) => runAction("Registrando movimiento de inventario...", () => createInventoryMovement(form), "Movimiento registrado.")}
            />
          ) : null}

          {activeTab === "tareas" ? (
            <TasksTab
              tasks={visibleTasks}
              costCenters={data.cost_centers}
              employees={data.employees}
              pending={isPending}
              onCreateTask={(form) => runAction("Creando tarea de produccion...", () => createProductionTask(form), "Tarea creada.")}
              onStatus={(task, status) => runAction("Actualizando tarea...", () => updateProductionTaskStatus(task.id, status), "Tarea actualizada.")}
            />
          ) : null}

          {activeTab === "consumos" ? (
            <ConsumptionTab
              tasks={activeTasks}
              items={data.items.filter((item) => item.active)}
              materials={data.task_materials}
              movements={data.movements}
              pending={isPending}
              onConsume={(form) => runAction("Registrando consumo de material...", () => consumeProductionMaterial(form), "Consumo registrado.")}
            />
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ProductionSchemaNotice({ message }: { message?: string }) {
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900">
      <div className="text-xs font-black uppercase tracking-wide">Produccion pendiente de activar</div>
      <h1 className="mt-1 text-2xl font-black">Falta aplicar la migracion de inventario</h1>
      <p className="mt-2 max-w-2xl text-sm">
        {message ?? "Ejecuta la migracion en Supabase y vuelve a abrir este modulo."}
      </p>
      <p className="mt-4 rounded-md bg-white/70 px-3 py-2 text-xs font-mono text-amber-950">
        supabase/migrations/20260707000000_inventory_production.sql
      </p>
    </div>
  );
}

function ProductionHome({
  tasks,
  lowStockItems,
  movements,
  pending,
  onOpenTab,
  onStatus,
}: {
  tasks: ProductionTask[];
  lowStockItems: InventoryItem[];
  movements: InventoryMovement[];
  pending: boolean;
  onOpenTab: (tab: Tab) => void;
  onStatus: (task: ProductionTask, status: ProductionTaskStatus) => void;
}) {
  const statusSummary = {
    pendiente: tasks.filter((task) => task.status === "pendiente").length,
    enProceso: tasks.filter((task) => task.status === "en_proceso").length,
    bloqueada: tasks.filter((task) => task.status === "bloqueada").length,
    pausada: tasks.filter((task) => task.status === "pausada").length,
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatusTile label="Pendientes" value={statusSummary.pendiente} tone="amber" />
          <StatusTile label="En proceso" value={statusSummary.enProceso} tone="sky" />
          <StatusTile label="Pausadas" value={statusSummary.pausada} tone="neutral" />
          <StatusTile label="Bloqueadas" value={statusSummary.bloqueada} tone="red" />
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-neutral-200 bg-white p-2 shadow-sm">
          <QuickActionButton label="Tarea" detail="crear" onClick={() => onOpenTab("tareas")} />
          <QuickActionButton label="Consumo" detail="material" onClick={() => onOpenTab("consumos")} />
          <QuickActionButton label="Stock" detail="revisar" onClick={() => onOpenTab("inventario")} />
        </div>
      </div>

      <ProcessRail tasks={tasks} />

      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.85fr]">
        <div className="rounded-2xl border border-neutral-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-100 px-4 py-3">
            <div>
              <h2 className="font-black text-neutral-950">Tablero de sala</h2>
              <p className="text-xs text-neutral-500">Tareas listas para iniciar, pausar, terminar o revisar.</p>
            </div>
            <span className="rounded-full bg-tecondor-magentaLight px-3 py-1 text-xs font-black text-tecondor-magentaDark">{tasks.length} activas</span>
          </div>
          <div className="max-h-[560px] space-y-3 overflow-auto p-3">
            {tasks.length ? tasks.map((task) => (
              <TaskRow key={task.id} task={task} pending={pending} onStatus={onStatus} />
            )) : (
              <EmptyPlantState onCreate={() => onOpenTab("tareas")} />
            )}
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-neutral-950">Stock critico</h2>
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-black text-amber-800">{lowStockItems.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {lowStockItems.length ? lowStockItems.slice(0, 8).map((item) => (
                <div key={item.id} className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold">{item.name}</div>
                      <div className="text-xs text-amber-800">{item.code} - minimo {formatQuantity(item.min_stock)} {item.unit}</div>
                    </div>
                    <div className="text-right text-sm font-black">{formatQuantity(item.stock)}</div>
                  </div>
                </div>
              )) : <EmptyState title="Stock estable" detail="No hay items por debajo del minimo configurado." compact />}
            </div>
          </div>

          <RecentMovements movements={movements.slice(0, 8)} />
        </div>
      </div>
    </div>
  );
}

function StatusTile({ label, value, tone }: { label: string; value: number; tone: "amber" | "sky" | "neutral" | "red" }) {
  const classes = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    sky: "border-sky-200 bg-sky-50 text-sky-900",
    neutral: "border-neutral-200 bg-neutral-50 text-neutral-800",
    red: "border-red-200 bg-red-50 text-red-800",
  };
  return (
    <div className={cn("rounded-2xl border px-4 py-3 shadow-sm", classes[tone])}>
      <div className="text-[11px] font-black uppercase tracking-wide opacity-70">{label}</div>
      <div className="mt-1 text-3xl font-black leading-none">{value}</div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/70">
        <div className="h-full rounded-full bg-current opacity-70" style={{ width: `${Math.min(100, value * 18)}%` }} />
      </div>
    </div>
  );
}

function QuickActionButton({ label, detail, onClick }: { label: string; detail: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border border-neutral-200 bg-white px-4 py-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-tecondor-magenta/30 hover:shadow-md"
    >
      <span className="block text-sm font-black text-neutral-950">{label}</span>
      <span className="mt-0.5 block text-xs font-semibold text-tecondor-magenta">{detail}</span>
    </button>
  );
}

function ProcessRail({ tasks }: { tasks: ProductionTask[] }) {
  const visibleProcesses = processOptions.slice(0, 8);
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="text-sm font-black text-neutral-950">Estaciones de trabajo</h2>
        <span className="rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-bold text-neutral-600">{tasks.length} tareas</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {visibleProcesses.map((process) => {
          const total = tasks.filter((task) => task.process_type === process).length;
          const running = tasks.filter((task) => task.process_type === process && task.status === "en_proceso").length;
          return (
            <div key={process} className="rounded-xl border border-neutral-100 bg-neutral-50 px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-bold text-neutral-800">{process}</span>
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-xs font-black",
                  running ? "bg-sky-100 text-sky-800" : total ? "bg-tecondor-magentaLight text-tecondor-magentaDark" : "bg-white text-neutral-500",
                )}>
                  {total}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white">
                <div
                  className={cn("h-full rounded-full", running ? "bg-sky-500" : total ? "bg-tecondor-magenta" : "bg-neutral-200")}
                  style={{ width: `${total ? Math.min(100, 25 + total * 12) : 8}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyPlantState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-200 bg-gradient-to-br from-neutral-50 to-white p-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-tecondor-magentaLight text-xl font-black text-tecondor-magentaDark">
        TP
      </div>
      <div className="mt-4 text-xl font-black text-neutral-900">Planta sin tareas activas</div>
      <div className="mx-auto mt-2 max-w-md text-sm text-neutral-500">
        Crea la primera tarea para que aparezca en la pantalla de sala y el operario pueda iniciarla.
      </div>
      <button type="button" className="btn-primary mt-5" onClick={onCreate}>
        Crear tarea de planta
      </button>
    </div>
  );
}

function InventoryTab({
  items,
  suppliers,
  costCenters,
  pending,
  onCreateItem,
  onMovement,
}: {
  items: InventoryItem[];
  suppliers: Supplier[];
  costCenters: CostCenterOption[];
  pending: boolean;
  onCreateItem: (input: Parameters<typeof createInventoryItem>[0]) => void;
  onMovement: (input: Parameters<typeof createInventoryMovement>[0]) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.25fr]">
      <div className="space-y-4">
        <Panel title="Crear item" detail="Alta rapida del inventario base.">
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const formData = new FormData(form);
              onCreateItem({
                code: textValue(formData, "code"),
                name: textValue(formData, "name"),
                category: textValue(formData, "category"),
                unit: textValue(formData, "unit"),
                stock: numberValue(formData, "stock"),
                average_cost: numberValue(formData, "average_cost"),
                min_stock: numberValue(formData, "min_stock"),
                location: textValue(formData, "location"),
                preferred_supplier_id: textValue(formData, "preferred_supplier_id"),
              });
              form.reset();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field name="code" label="Codigo" placeholder="INV-0001" />
              <Field name="category" label="Categoria" placeholder="Perfil, rodamiento..." />
            </div>
            <Field name="name" label="Nombre del material" placeholder="Tubo SCH40, lamina, pintura..." required />
            <div className="grid gap-3 sm:grid-cols-3">
              <Field name="unit" label="Unidad" placeholder="und, m, kg" defaultValue="und" />
              <Field name="stock" label="Stock inicial" type="number" step="0.001" />
              <Field name="average_cost" label="Costo promedio" type="number" step="0.01" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field name="min_stock" label="Minimo" type="number" step="0.001" />
              <Field name="location" label="Ubicacion" placeholder="Bodega, estante..." />
            </div>
            <SelectField name="preferred_supplier_id" label="Proveedor preferido" options={suppliers.map((s) => [s.id, supplierLabel(s)])} blank="Sin proveedor fijo" />
            <button className="btn-primary" disabled={pending}>Guardar item</button>
          </form>
        </Panel>

        <Panel title="Movimiento manual" detail="Entradas, salidas o ajustes de stock.">
          <form
            className="grid gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const formData = new FormData(form);
              onMovement({
                item_id: textValue(formData, "item_id"),
                movement_type: textValue(formData, "movement_type") as InventoryMovementType,
                quantity: numberValue(formData, "quantity"),
                unit_cost: numberValue(formData, "unit_cost"),
                cost_center_code: textValue(formData, "cost_center_code"),
                notes: textValue(formData, "notes"),
                movement_date: textValue(formData, "movement_date"),
              });
              form.reset();
            }}
          >
            <SelectField name="item_id" label="Item" options={items.map((item) => [item.id, `${item.code} - ${item.name}`])} blank="Selecciona item..." required />
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField name="movement_type" label="Tipo" options={[["entrada", "Entrada"], ["salida", "Salida"], ["ajuste", "Ajuste"]]} />
              <Field name="quantity" label="Cantidad" type="number" step="0.001" required />
              <Field name="unit_cost" label="Costo unitario" type="number" step="0.01" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField name="cost_center_code" label="Centro de costo" options={costCenters.map((cc) => [cc.code, costCenterLabel(cc)])} blank="Opcional" />
              <Field name="movement_date" label="Fecha" type="date" defaultValue={todayInputValue()} />
            </div>
            <Field name="notes" label="Nota" placeholder="Compra, ajuste, salida manual..." />
            <button className="btn-secondary" disabled={pending}>Registrar movimiento</button>
          </form>
        </Panel>
      </div>

      <Panel title="Inventario actual" detail={`${items.length} items registrados`}>
        <div className="max-h-[620px] overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Categoria</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2 text-right">Costo prom.</th>
                <th className="px-3 py-2 text-left">Ubicacion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2">
                    <div className="font-bold">{item.name}</div>
                    <div className="text-xs text-neutral-500">{item.code}</div>
                  </td>
                  <td className="px-3 py-2 text-neutral-600">{item.category}</td>
                  <td className={cn("px-3 py-2 text-right font-black", item.min_stock > 0 && item.stock <= item.min_stock ? "text-amber-700" : "text-neutral-900")}>
                    {formatQuantity(item.stock)} {item.unit}
                  </td>
                  <td className="px-3 py-2 text-right">{formatCOP(item.average_cost)}</td>
                  <td className="px-3 py-2 text-neutral-600">{item.location || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!items.length ? <EmptyState title="Inventario vacio" detail="Crea el primer item para empezar a controlar consumos." /> : null}
        </div>
      </Panel>
    </div>
  );
}

function TasksTab({
  tasks,
  costCenters,
  employees,
  pending,
  onCreateTask,
  onStatus,
}: {
  tasks: ProductionTask[];
  costCenters: CostCenterOption[];
  employees: ProductionEmployeeOption[];
  pending: boolean;
  onCreateTask: (input: Parameters<typeof createProductionTask>[0]) => void;
  onStatus: (task: ProductionTask, status: ProductionTaskStatus) => void;
}) {
  const employeeOptions = useMemo(() => productionEmployeeOptions(employees), [employees]);
  return (
    <div className="grid gap-4 xl:grid-cols-[0.85fr_1.2fr]">
      <Panel title="Nueva tarea" detail="Pensado para operarios y supervision.">
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const formData = new FormData(form);
            onCreateTask({
              title: textValue(formData, "title"),
              process_type: textValue(formData, "process_type"),
              cost_center_code: textValue(formData, "cost_center_code"),
              assigned_to: textValue(formData, "assigned_to"),
              priority: textValue(formData, "priority") as ProductionTaskPriority,
              planned_quantity: numberValue(formData, "planned_quantity"),
              estimated_minutes: numberValue(formData, "estimated_minutes"),
              notes: textValue(formData, "notes"),
            });
            form.reset();
          }}
        >
          <Field name="title" label="Tarea" placeholder="Cortar perfiles, soldar base, pintar piezas..." required />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField name="process_type" label="Proceso" options={processOptions.map((p) => [p, p])} />
            <SelectField name="cost_center_code" label="Centro de costo" options={costCenters.map((cc) => [cc.code, costCenterLabel(cc)])} blank="Sin centro todavia" />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField
              name="assigned_to"
              label="Responsable"
              options={employeeOptions}
              blank={employeeOptions.length ? "Selecciona empleado" : "Marca roles en Nomina"}
            />
            <SelectField name="priority" label="Prioridad" options={Object.entries(priorityLabels)} />
            <Field name="planned_quantity" label="Cantidad" type="number" step="0.001" defaultValue="1" />
          </div>
          <Field name="estimated_minutes" label="Tiempo estimado (min)" type="number" />
          <TextareaField name="notes" label="Notas" placeholder="Material, medida, acabado, cuidado especial..." />
          <button className="btn-primary" disabled={pending}>Crear tarea</button>
        </form>
      </Panel>

      <Panel title="Derrotero de tareas" detail={`${tasks.length} tareas visibles`}>
        <div className="max-h-[640px] divide-y divide-neutral-100 overflow-auto">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} pending={pending} onStatus={onStatus} />
          ))}
          {!tasks.length ? <EmptyState title="No hay tareas" detail="Crea la primera tarea de produccion." /> : null}
        </div>
      </Panel>
    </div>
  );
}

function ConsumptionTab({
  tasks,
  items,
  materials,
  movements,
  pending,
  onConsume,
}: {
  tasks: ProductionTask[];
  items: InventoryItem[];
  materials: { id: string; task_id: string; consumed_quantity: number; item?: InventoryItem | null }[];
  movements: InventoryMovement[];
  pending: boolean;
  onConsume: (input: Parameters<typeof consumeProductionMaterial>[0]) => void;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-[0.85fr_1.2fr]">
      <Panel title="Consumir material" detail="Descuenta inventario y carga el costo al centro de la tarea.">
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const formData = new FormData(form);
            onConsume({
              task_id: textValue(formData, "task_id"),
              item_id: textValue(formData, "item_id"),
              quantity: numberValue(formData, "quantity"),
              notes: textValue(formData, "notes"),
            });
            form.reset();
          }}
        >
          <SelectField name="task_id" label="Tarea" options={tasks.map((task) => [task.id, taskLabel(task)])} blank="Selecciona tarea..." required />
          <SelectField name="item_id" label="Item de inventario" options={items.map((item) => [item.id, `${item.code} - ${item.name} (${formatQuantity(item.stock)} ${item.unit})`])} blank="Selecciona material..." required />
          <Field name="quantity" label="Cantidad usada" type="number" step="0.001" required />
          <Field name="notes" label="Nota" placeholder="Corte, desperdicio, pieza usada..." />
          <button className="btn-primary" disabled={pending}>Registrar consumo</button>
        </form>
      </Panel>

      <div className="grid gap-4">
        <Panel title="Materiales consumidos por tarea" detail={`${materials.length} registros`}>
          <div className="max-h-[280px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-white text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left">Material</th>
                  <th className="px-3 py-2 text-right">Consumido</th>
                  <th className="px-3 py-2 text-right">Costo ref.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {materials.slice(0, 80).map((material) => (
                  <tr key={material.id}>
                    <td className="px-3 py-2">
                      <div className="font-bold">{material.item?.name ?? "Item"}</div>
                      <div className="text-xs text-neutral-500">{material.item?.code ?? "-"}</div>
                    </td>
                    <td className="px-3 py-2 text-right">{formatQuantity(material.consumed_quantity)} {material.item?.unit ?? ""}</td>
                    <td className="px-3 py-2 text-right">{formatCOP(Number(material.item?.average_cost || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!materials.length ? <EmptyState title="Sin consumos" detail="Los materiales usados apareceran aqui." compact /> : null}
          </div>
        </Panel>
        <RecentMovements movements={movements.filter((m) => m.movement_type === "salida").slice(0, 10)} />
      </div>
    </div>
  );
}

function TaskRow({
  task,
  pending,
  onStatus,
}: {
  task: ProductionTask;
  pending: boolean;
  onStatus: (task: ProductionTask, status: ProductionTaskStatus) => void;
}) {
  const statusAccent: Record<ProductionTaskStatus, string> = {
    pendiente: "border-l-amber-400",
    en_proceso: "border-l-sky-500",
    pausada: "border-l-neutral-400",
    bloqueada: "border-l-red-500",
    terminada: "border-l-emerald-500",
    revisada: "border-l-tecondor-magenta",
    cancelada: "border-l-neutral-300",
  };
  return (
    <div className={cn("grid gap-4 rounded-2xl border border-l-4 border-neutral-200 bg-white px-4 py-4 shadow-sm transition hover:border-neutral-300 hover:shadow-md md:grid-cols-[1fr_auto] md:items-center", statusAccent[task.status])}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-neutral-950 px-2.5 py-1 font-mono text-xs font-black text-white">TP-{String(task.task_number || 0).padStart(4, "0")}</span>
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          {task.cost_center_code ? <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-bold text-neutral-600">{task.cost_center_code}</span> : null}
        </div>
        <div className="mt-3 text-lg font-black leading-tight text-neutral-950">{task.title}</div>
        <div className="mt-3 grid gap-2 text-xs text-neutral-600 sm:grid-cols-2 lg:grid-cols-4">
          <TaskFact label="Proceso" value={task.process_type} />
          <TaskFact label="Operario" value={task.assigned_to || "Sin responsable"} />
          <TaskFact label="Cantidad" value={`${formatQuantity(task.planned_quantity)} und`} />
          <TaskFact label="Tiempo" value={task.estimated_minutes ? `${task.estimated_minutes} min` : "Sin estimar"} />
        </div>
        {task.notes ? <p className="mt-2 line-clamp-2 text-xs text-neutral-500">{task.notes}</p> : null}
      </div>
      <div className="flex flex-wrap gap-2 md:min-w-[210px] md:justify-end">
        {task.status === "pendiente" || task.status === "pausada" ? (
          <button type="button" className="btn-secondary h-11 px-4 text-sm" disabled={pending} onClick={() => onStatus(task, "en_proceso")}>
            Iniciar
          </button>
        ) : null}
        {task.status === "en_proceso" ? (
          <>
            <button type="button" className="btn-secondary h-11 px-4 text-sm" disabled={pending} onClick={() => onStatus(task, "pausada")}>
              Pausar
            </button>
            <button type="button" className="btn-primary h-11 px-4 text-sm" disabled={pending} onClick={() => onStatus(task, "terminada")}>
              Terminar
            </button>
          </>
        ) : null}
        {task.status === "terminada" ? (
          <button type="button" className="btn-primary h-11 px-4 text-sm" disabled={pending} onClick={() => onStatus(task, "revisada")}>
            Revisar
          </button>
        ) : null}
      </div>
    </div>
  );
}

function TaskFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-neutral-50 px-3 py-2">
      <div className="text-[10px] font-black uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="truncate text-sm font-bold text-neutral-800">{value}</div>
    </div>
  );
}

function RecentMovements({ movements }: { movements: InventoryMovement[] }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-black text-neutral-950">Movimientos recientes</h2>
        <span className="text-xs text-neutral-500">{movements.length}</span>
      </div>
      <div className="mt-3 max-h-[300px] divide-y divide-neutral-100 overflow-auto">
        {movements.length ? movements.map((movement) => (
          <div key={movement.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm">
            <div className="min-w-0">
              <div className="truncate font-bold">{movement.item?.name ?? "Item"}</div>
              <div className="text-xs text-neutral-500">{formatDateShort(movement.movement_date)} - {movement.cost_center_code || "Sin centro"}</div>
            </div>
            <div className={cn("text-right font-black", movement.movement_type === "entrada" ? "text-emerald-700" : movement.movement_type === "salida" ? "text-red-700" : "text-amber-700")}>
              {movement.movement_type === "entrada" ? "+" : movement.movement_type === "salida" ? "-" : ""}
              {formatQuantity(Math.abs(movement.quantity))}
            </div>
          </div>
        )) : <EmptyState title="Sin movimientos" detail="Entradas, salidas y ajustes se veran aqui." compact />}
      </div>
    </div>
  );
}

function Panel({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h2 className="font-black text-neutral-950">{title}</h2>
        {detail ? <p className="text-xs text-neutral-500">{detail}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "magenta" | "green" | "amber" | "sky" }) {
  const toneClasses = {
    magenta: "border-tecondor-magenta/15 bg-tecondor-magentaLight text-tecondor-magentaDark",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    sky: "border-sky-200 bg-sky-50 text-sky-800",
  };
  return (
    <div className={cn("rounded-2xl border px-3 py-3 shadow-sm", toneClasses[tone])}>
      <div className="text-[10px] font-black uppercase tracking-wide opacity-75">{label}</div>
      <div className="mt-1 text-lg font-black leading-none sm:text-xl">{value}</div>
      <div className="truncate text-[11px] opacity-75">{detail}</div>
    </div>
  );
}

function Field({
  name,
  label,
  type = "text",
  placeholder,
  required,
  step,
  defaultValue,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  step?: string;
  defaultValue?: string;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input name={name} type={type} required={required} step={step} defaultValue={defaultValue} placeholder={placeholder} className="input" />
    </label>
  );
}

function TextareaField({ name, label, placeholder }: { name: string; label: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <textarea name={name} placeholder={placeholder} rows={3} className="input resize-y" />
    </label>
  );
}

function SelectField({
  name,
  label,
  options,
  blank,
  required,
}: {
  name: string;
  label: string;
  options: Array<[string, string]>;
  blank?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select name={name} required={required} className="input">
        {blank ? <option value="">{blank}</option> : null}
        {options.map(([value, labelText]) => (
          <option key={value} value={value}>{labelText}</option>
        ))}
      </select>
    </label>
  );
}

function productionEmployeeOptions(employees: ProductionEmployeeOption[]): Array<[string, string]> {
  const roleOrder = ["operario", "ingeniero", "supervisor", "logistica", "administrativo"];
  return [...employees]
    .sort((a, b) => {
      const aRank = Math.min(...a.roles.map((role) => roleOrder.indexOf(role)).filter((rank) => rank >= 0));
      const bRank = Math.min(...b.roles.map((role) => roleOrder.indexOf(role)).filter((rank) => rank >= 0));
      return (Number.isFinite(aRank) ? aRank : 99) - (Number.isFinite(bRank) ? bRank : 99) || a.name.localeCompare(b.name);
    })
    .map((employee) => [
      employee.name,
      `${employee.name} - ${employee.roles.map(productionRoleLabel).join(", ")}`,
    ]);
}

function productionRoleLabel(role: string): string {
  const labels: Record<string, string> = {
    operario: "Operario",
    ingeniero: "Ingeniero",
    supervisor: "Supervisor",
    logistica: "Logistica",
    administrativo: "Administrativo",
  };
  return labels[role] ?? role;
}

function StatusBadge({ status }: { status: ProductionTaskStatus }) {
  const classes: Record<ProductionTaskStatus, string> = {
    pendiente: "bg-amber-50 text-amber-800",
    en_proceso: "bg-sky-50 text-sky-800",
    pausada: "bg-neutral-100 text-neutral-700",
    bloqueada: "bg-red-50 text-red-700",
    terminada: "bg-emerald-50 text-emerald-800",
    revisada: "bg-tecondor-magentaLight text-tecondor-magentaDark",
    cancelada: "bg-neutral-100 text-neutral-500",
  };
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", classes[status])}>{statusLabels[status]}</span>;
}

function PriorityBadge({ priority }: { priority: ProductionTaskPriority }) {
  const classes: Record<ProductionTaskPriority, string> = {
    baja: "bg-neutral-100 text-neutral-600",
    media: "bg-sky-50 text-sky-700",
    alta: "bg-amber-50 text-amber-800",
    urgente: "bg-red-50 text-red-700",
  };
  return <span className={cn("rounded-full px-2 py-0.5 text-xs font-bold", classes[priority])}>{priorityLabels[priority]}</span>;
}

function EmptyState({ title, detail, compact }: { title: string; detail: string; compact?: boolean }) {
  return (
    <div className={cn("rounded-xl border border-dashed border-neutral-200 bg-neutral-50 text-center", compact ? "p-3" : "m-4 p-6")}>
      <div className="font-bold text-neutral-700">{title}</div>
      <div className="mt-1 text-xs text-neutral-500">{detail}</div>
    </div>
  );
}

function buildMetrics(items: InventoryItem[], tasks: ProductionTask[], movements: InventoryMovement[]) {
  const monthKey = todayInputValue().slice(0, 7);
  const activeTasks = tasks.filter((task) => !["terminada", "revisada", "cancelada"].includes(task.status)).length;
  const inProcessTasks = tasks.filter((task) => task.status === "en_proceso").length;
  const lowStock = items.filter((item) => item.active && item.min_stock > 0 && item.stock <= item.min_stock).length;
  const stockValue = items.reduce((sum, item) => sum + Number(item.stock || 0) * Number(item.average_cost || 0), 0);
  const monthConsumption = movements
    .filter((movement) => movement.movement_type === "salida" && String(movement.movement_date || "").startsWith(monthKey))
    .reduce((sum, movement) => sum + Number(movement.total_cost || 0), 0);
  return { activeTasks, inProcessTasks, lowStock, stockValue, monthConsumption };
}

function textValue(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function numberValue(formData: FormData, key: string): number {
  const raw = textValue(formData, key);
  if (!raw) return 0;
  const normalized = raw.replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

function supplierLabel(supplier: Supplier): string {
  return `${supplier.name}${supplier.nit ? ` - ${supplier.nit}` : ""}`;
}

function costCenterLabel(costCenter: CostCenterOption): string {
  const name = costCenter.name || costCenter.client_name;
  return `${costCenter.code}${name ? ` - ${name}` : ""}`;
}

function taskLabel(task: ProductionTask): string {
  return `TP-${String(task.task_number || 0).padStart(4, "0")} - ${task.title}`;
}

function todayInputValue(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
