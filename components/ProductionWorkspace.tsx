"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import {
  archiveInventoryItem,
  consumeProductionMaterials,
  createInventoryItem,
  createInventoryMovement,
  createProductionTask,
  updateInventoryItem,
  updateProductionSubtaskStatus,
  updateProductionTaskStatus,
} from "@/app/actions/produccion";
import { formatCOP, formatDateShort, formatQuantity } from "@/lib/formatters";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type {
  CostCenterOption,
  InventoryItem,
  InventoryMovement,
  InventoryMovementType,
  ProductionEmployeeOption,
  ProductionTask,
  ProductionTaskMaterial,
  ProductionTaskPriority,
  ProductionTaskStatus,
  ProductionSubtask,
  ProductionSubtaskInput,
  ProductionWorkspaceData,
  Supplier,
} from "@/lib/types";

type Tab = "tareas" | "inventario" | "consumos";
type WorkspaceModal = "task" | "consumption" | "item" | "edit-item" | "movement" | null;
type Feedback = { type: "success" | "error" | "info"; text: string } | null;
type DraftSubtask = {
  id: string;
  title: string;
  notes: string;
  employeeIds: string[];
  files: File[];
};
type TaskCreateSubmission = {
  input: Parameters<typeof createProductionTask>[0];
  taskFiles: File[];
  subtaskFiles: File[][];
  fileCount: number;
};

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

export function ProductionWorkspace({ data, email, userName }: { data: ProductionWorkspaceData; email: string; userName: string }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("tareas");
  const [modal, setModal] = useState<WorkspaceModal>(null);
  const [consumptionTaskId, setConsumptionTaskId] = useState("");
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [highlightedTaskId, setHighlightedTaskId] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [isPending, startTransition] = useTransition();
  const knownNotificationIds = useRef<Set<string> | null>(null);

  const visibleTasks = data.tasks.filter((task) => task.status !== "cancelada");
  const activeTasks = visibleTasks.filter((task) => !["terminada", "revisada"].includes(task.status));
  const taskNotifications = useMemo(() => data.tasks
    .filter((task) => task.status === "terminada" && taskBelongsToUser(task, email, userName))
    .map((task) => ({
      id: task.id,
      title: `TP-${String(task.task_number || 0).padStart(4, "0")} · ${task.title}`,
      detail: `${task.assigned_to || "Operario"} termino esta tarea`,
    })), [data.tasks, email, userName]);

  useEffect(() => {
    if (!feedback || feedback.type === "info") return;
    const timeout = window.setTimeout(() => setFeedback(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [feedback]);

  useEffect(() => {
    const refresh = () => router.refresh();
    const interval = window.setInterval(refresh, 30000);
    const onVisibilityChange = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [router]);

  useEffect(() => {
    const currentIds = new Set(taskNotifications.map((notification) => notification.id));
    if (!knownNotificationIds.current) {
      knownNotificationIds.current = currentIds;
      return;
    }

    const newNotifications = taskNotifications.filter((notification) => !knownNotificationIds.current?.has(notification.id));
    knownNotificationIds.current = currentIds;
    if (!newNotifications.length || !("Notification" in window) || Notification.permission !== "granted" || !("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.ready.then((registration) => Promise.all(newNotifications.map((notification) => registration.showNotification(
      "Tarea de produccion terminada",
      { body: notification.title, tag: `production-task-${notification.id}`, data: { url: `/#task-${notification.id}` } },
    ))));
  }, [taskNotifications]);

  function openConsumption(taskId = "") {
    setConsumptionTaskId(taskId);
    setModal("consumption");
  }

  function runPrimaryAction() {
    if (activeTab === "inventario") {
      setModal("item");
      return;
    }
    if (activeTab === "consumos") {
      openConsumption();
      return;
    }
    setModal("task");
  }

  const primaryActionLabel = activeTab === "inventario"
    ? "Nuevo item"
    : activeTab === "consumos"
      ? "Registrar consumo"
      : "Nueva tarea";

  function runAction(
    label: string,
    action: () => Promise<unknown>,
    success = "Listo. Cambios guardados.",
    onSuccess?: () => void,
  ) {
    startTransition(async () => {
      setFeedback({ type: "info", text: label });
      try {
        await action();
        setFeedback({ type: "success", text: success });
        onSuccess?.();
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
    <>
      <AppHeader
        email={email}
        activeSection={activeTab}
        primaryActionLabel={primaryActionLabel}
        notificationCount={taskNotifications.length}
        onSectionChange={setActiveTab}
        onPrimaryAction={runPrimaryAction}
        onNotificationsClick={() => { setHighlightedTaskId(taskNotifications[0]?.id || ""); setActiveTab("tareas"); }}
      />
      <main className="production-main">
        <div className="production-workspace">
          <section className="production-console">
        <div className="production-console__main">
          <div className="production-console__content">
          {activeTab === "inventario" ? (
            <InventoryTab
              items={data.items.filter((item) => item.active)}
              pending={isPending}
              onMovement={() => setModal("movement")}
              onEdit={(item) => { setEditingItem(item); setModal("edit-item"); }}
              onDelete={(item) => runAction("Eliminando item...", () => archiveInventoryItem(item.id), "Item eliminado del inventario.")}
            />
          ) : null}

          {activeTab === "tareas" ? (
            <TasksTab
              tasks={visibleTasks}
              pending={isPending}
              email={email}
              userName={userName}
              highlightedTaskId={highlightedTaskId}
              onConsumeTask={openConsumption}
              onStatus={(task, status) => runAction("Actualizando tarea...", () => updateProductionTaskStatus(task.id, status), "Tarea actualizada.")}
              onSubtaskStatus={(subtask, status) => runAction("Actualizando subtarea...", () => updateProductionSubtaskStatus(subtask.id, status), "Subtarea actualizada.")}
              onDelete={(task) => runAction("Eliminando tarea...", () => updateProductionTaskStatus(task.id, "cancelada", "Tarea eliminada del tablero"), "Tarea eliminada.")}
            />
          ) : null}

          {activeTab === "consumos" ? (
            <ConsumptionTab
              tasks={activeTasks}
              items={data.items.filter((item) => item.active)}
              materials={data.task_materials}
              movements={data.movements}
            />
          ) : null}
          </div>
            </div>
          </section>
        </div>
      </main>

      <button type="button" className="mobile-primary-action" onClick={runPrimaryAction}>
        <span aria-hidden="true">+</span>{primaryActionLabel}
      </button>

      {feedback ? <WorkspaceToast feedback={feedback} /> : null}

      <WorkspaceModalPanel open={modal === "task"} title="Crear tarea de produccion" detail="Asigna el trabajo sin salir del tablero." onClose={() => setModal(null)} wide>
        <TaskCreateForm
          costCenters={data.cost_centers}
          employees={data.employees}
          extensionsReady={data.taskExtensionsReady}
          pending={isPending}
          onCancel={() => setModal(null)}
          onSubmit={(submission) => runAction(
            submission.fileCount ? "Subiendo adjuntos y creando tarea..." : "Creando tarea de produccion...",
            () => createProductionTaskWithUploads(submission),
            "Tarea creada.",
            () => { setModal(null); setActiveTab("tareas"); },
          )}
        />
      </WorkspaceModalPanel>

      <WorkspaceModalPanel open={modal === "consumption"} title="Registrar consumos" detail="Busca materiales, agrega cantidades y guárdalos juntos." onClose={() => setModal(null)} wide>
        <ConsumptionForm
          key={consumptionTaskId || "consumo-manual"}
          tasks={activeTasks}
          items={data.items.filter((item) => item.active)}
          defaultTaskId={consumptionTaskId}
          pending={isPending}
          onCancel={() => setModal(null)}
          onSubmit={(form) => runAction("Registrando materiales consumidos...", () => consumeProductionMaterials(form), `${form.items.length} consumo${form.items.length === 1 ? "" : "s"} registrado${form.items.length === 1 ? "" : "s"}.`, () => { setModal(null); setConsumptionTaskId(""); setActiveTab("consumos"); })}
        />
      </WorkspaceModalPanel>

      <WorkspaceModalPanel open={modal === "item"} title="Nuevo item de inventario" detail="Crea el material y déjalo listo para movimientos y consumos." onClose={() => setModal(null)} wide>
        <InventoryItemForm
          suppliers={data.suppliers}
          pending={isPending}
          onCancel={() => setModal(null)}
          onSubmit={(form) => runAction("Creando item de inventario...", () => createInventoryItem(form), "Item creado.", () => { setModal(null); setActiveTab("inventario"); })}
        />
      </WorkspaceModalPanel>

      <WorkspaceModalPanel open={modal === "edit-item"} title="Editar item de inventario" detail="Corrige la informacion y la cantidad disponible." onClose={() => { setModal(null); setEditingItem(null); }} wide>
        {editingItem ? (
          <InventoryItemEditForm
            item={editingItem}
            suppliers={data.suppliers}
            pending={isPending}
            onCancel={() => { setModal(null); setEditingItem(null); }}
            onSubmit={(form) => runAction("Actualizando item...", () => updateInventoryItem(editingItem.id, form), "Item actualizado.", () => { setModal(null); setEditingItem(null); setActiveTab("inventario"); })}
          />
        ) : null}
      </WorkspaceModalPanel>

      <WorkspaceModalPanel open={modal === "movement"} title="Movimiento de inventario" detail="Registra una entrada, salida o ajuste manual." onClose={() => setModal(null)} wide>
        <InventoryMovementForm
          items={data.items.filter((item) => item.active)}
          costCenters={data.cost_centers}
          pending={isPending}
          onCancel={() => setModal(null)}
          onSubmit={(form) => runAction("Registrando movimiento de inventario...", () => createInventoryMovement(form), "Movimiento registrado.", () => { setModal(null); setActiveTab("inventario"); })}
        />
      </WorkspaceModalPanel>
    </>
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
  onCreateTask,
  onConsumeTask,
  onStatus,
}: {
  tasks: ProductionTask[];
  lowStockItems: InventoryItem[];
  movements: InventoryMovement[];
  pending: boolean;
  onOpenTab: (tab: Tab) => void;
  onCreateTask: () => void;
  onConsumeTask: (taskId?: string) => void;
  onStatus: (task: ProductionTask, status: ProductionTaskStatus) => void;
}) {
  const statusSummary = {
    pendiente: tasks.filter((task) => task.status === "pendiente").length,
    enProceso: tasks.filter((task) => task.status === "en_proceso").length,
    pausada: tasks.filter((task) => task.status === "pausada").length,
  };

  return (
    <div className="production-home space-y-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="grid grid-cols-3 gap-3">
          <StatusTile label="Pendientes" value={statusSummary.pendiente} tone="amber" />
          <StatusTile label="En proceso" value={statusSummary.enProceso} tone="sky" />
          <StatusTile label="Pausadas" value={statusSummary.pausada} tone="neutral" />
        </div>
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-neutral-200 bg-white p-2 shadow-sm">
          <QuickActionButton label="Tarea" detail="crear" onClick={onCreateTask} />
          <QuickActionButton label="Consumo" detail="material" onClick={() => onConsumeTask()} />
          <QuickActionButton label="Stock" detail="revisar" onClick={() => onOpenTab("inventario")} />
        </div>
      </div>

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
              <TaskRow key={task.id} task={task} pending={pending} onStatus={onStatus} onConsume={() => onConsumeTask(task.id)} />
            )) : (
              <EmptyPlantState onCreate={onCreateTask} />
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
  pending,
  onMovement,
  onEdit,
  onDelete,
}: {
  items: InventoryItem[];
  pending: boolean;
  onMovement: () => void;
  onEdit: (item: InventoryItem) => void;
  onDelete: (item: InventoryItem) => void;
}) {
  const [query, setQuery] = useState("");
  const normalizedQuery = normalizeSearchText(query);
  const filteredItems = useMemo(() => normalizedQuery
    ? items.filter((item) => normalizeSearchText(`${item.code} ${item.name} ${item.category} ${item.location || ""}`).includes(normalizedQuery))
    : items, [items, normalizedQuery]);
  const criticalStock = items.filter((item) => item.active && item.min_stock > 0 && item.stock <= item.min_stock).length;
  return (
    <div className="workspace-section workspace-section--inventory">
      <div className="section-toolbar">
        <div>
          <h2>Inventario actual</h2>
          <p>{items.length} items registrados y disponibles para consumo.</p>
        </div>
        <div className="section-toolbar__actions">
          <SectionStat value={criticalStock} label="Stock critico" tone="amber" />
          <button type="button" className="btn-secondary" disabled={pending} onClick={onMovement}>Movimiento</button>
        </div>
      </div>
      <label className="list-search">
        <span>Buscar inventario</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Código, material, categoría o ubicación..." aria-label="Buscar en inventario" />
        <b>{filteredItems.length}</b>
      </label>
      <Panel title="Existencias" detail={query ? `${filteredItems.length} coincidencias de ${items.length} items.` : "Consulta rápida de stock, costo y ubicación."}>
        <div className="workspace-table">
          <table className="min-w-full text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-neutral-500">
              <tr>
                <th className="px-3 py-2 text-left">Item</th>
                <th className="px-3 py-2 text-left">Categoria</th>
                <th className="px-3 py-2 text-right">Stock</th>
                <th className="px-3 py-2 text-right">Costo prom.</th>
                <th className="px-3 py-2 text-left">Ubicacion</th>
                <th className="px-3 py-2 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {filteredItems.map((item) => (
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
                  <td className="px-3 py-2">
                    <div className="inventory-row-actions">
                      <button type="button" className="btn-secondary" disabled={pending} onClick={() => onEdit(item)}>Editar</button>
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(`¿Eliminar ${item.name} del inventario? Su historial se conservará.`)) onDelete(item);
                        }}
                      >
                        Eliminar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filteredItems.length ? <EmptyState title={items.length ? "Sin coincidencias" : "Inventario vacio"} detail={items.length ? "Prueba con otro nombre, código o ubicación." : "Crea el primer item para empezar a controlar consumos."} /> : null}
        </div>
      </Panel>
    </div>
  );
}

function TasksTab({
  tasks,
  pending,
  email,
  userName,
  highlightedTaskId,
  onConsumeTask,
  onStatus,
  onSubtaskStatus,
  onDelete,
}: {
  tasks: ProductionTask[];
  pending: boolean;
  email: string;
  userName: string;
  highlightedTaskId: string;
  onConsumeTask: (taskId?: string) => void;
  onStatus: (task: ProductionTask, status: ProductionTaskStatus) => void;
  onSubtaskStatus: (subtask: ProductionSubtask, status: ProductionTaskStatus) => void;
  onDelete: (task: ProductionTask) => void;
}) {
  const [filter, setFilter] = useState<"todas" | "activas" | "mias" | ProductionTaskStatus>("todas");
  const filteredTasks = filter === "todas"
    ? tasks
    : filter === "activas"
    ? tasks.filter((task) => !["terminada", "revisada", "cancelada"].includes(task.status))
    : filter === "mias"
      ? tasks.filter((task) => taskBelongsToUser(task, email, userName))
      : tasks.filter((task) => task.status === filter);
  const activeCount = tasks.filter((task) => !["terminada", "revisada", "cancelada"].includes(task.status)).length;
  const filters: Array<["todas" | "activas" | "mias" | ProductionTaskStatus, string, number]> = [
    ["todas", "Todas", tasks.length],
    ["mias", "Mis tareas", tasks.filter((task) => taskBelongsToUser(task, email, userName)).length],
    ["activas", "Activas", activeCount],
    ["pendiente", "Pendientes", tasks.filter((task) => task.status === "pendiente").length],
    ["en_proceso", "En proceso", tasks.filter((task) => task.status === "en_proceso").length],
    ["pausada", "Pausadas", tasks.filter((task) => task.status === "pausada").length],
    ["terminada", "Terminadas", tasks.filter((task) => task.status === "terminada").length],
    ["revisada", "Revisadas", tasks.filter((task) => task.status === "revisada").length],
  ];

  useEffect(() => {
    if (highlightedTaskId) setFilter("todas");
  }, [highlightedTaskId]);

  useEffect(() => {
    if (!highlightedTaskId || filter !== "todas") return;
    const timeout = window.setTimeout(() => document.getElementById(`task-${highlightedTaskId}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    return () => window.clearTimeout(timeout);
  }, [filter, highlightedTaskId]);

  return (
    <div className="workspace-section workspace-section--tasks">
      <div className="section-toolbar">
        <div>
          <h2>Derrotero de tareas</h2>
          <p>{filteredTasks.length} tareas en la vista seleccionada.</p>
        </div>
        <SectionStat value={activeCount} label="Tareas activas" tone="magenta" />
      </div>
      <div className="task-filters" aria-label="Filtrar tareas">
        {filters.map(([value, label, count]) => (
          <button key={value} type="button" className={cn(filter === value && "is-active")} onClick={() => setFilter(value)}>
            <span>{label}</span><b>{count}</b>
          </button>
        ))}
      </div>
      <Panel title="Tareas de planta" detail="Inicia, pausa, termina o registra material desde la misma fila.">
        <div className="workspace-list divide-y divide-neutral-100">
          {filteredTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              pending={pending}
              highlighted={task.id === highlightedTaskId}
              onStatus={onStatus}
              onSubtaskStatus={onSubtaskStatus}
              onDelete={onDelete}
              onConsume={() => onConsumeTask(task.id)}
            />
          ))}
          {!filteredTasks.length ? <EmptyState title="No hay tareas en esta vista" detail="Cambia el filtro o crea una nueva tarea de produccion." /> : null}
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
}: {
  tasks: ProductionTask[];
  items: InventoryItem[];
  materials: ProductionTaskMaterial[];
  movements: InventoryMovement[];
}) {
  return (
    <div className="workspace-section">
      <div className="section-toolbar">
        <div>
          <h2>Consumos de materiales</h2>
          <p>{tasks.length} tareas activas · {items.length} materiales disponibles.</p>
        </div>
      </div>
      <div className="consumption-grid">
        <Panel title="Materiales consumidos por tarea" detail={`${materials.length} registros`}>
          <div className="workspace-table">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 bg-white text-xs uppercase text-neutral-500">
                <tr>
                  <th className="px-3 py-2 text-left">Tarea</th>
                  <th className="px-3 py-2 text-left">Material</th>
                  <th className="px-3 py-2 text-right">Consumido</th>
                  <th className="px-3 py-2 text-right">Costo consumido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {materials.slice(0, 80).map((material) => (
                  <tr key={material.id}>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs font-black">{material.task ? `TP-${String(material.task.task_number || 0).padStart(4, "0")}` : "Tarea"}</div>
                      <div className="max-w-48 truncate text-xs text-neutral-500">{material.task?.title || "Sin detalle"}</div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-bold">{material.item?.name ?? "Item"}</div>
                      <div className="text-xs text-neutral-500">{material.item?.code ?? "-"}</div>
                    </td>
                    <td className="px-3 py-2 text-right">{formatQuantity(material.consumed_quantity)} {material.item?.unit ?? ""}</td>
                    <td className="px-3 py-2 text-right">
                      <div className="font-bold">{formatCOP(material.consumed_quantity * material.unit_cost_snapshot)}</div>
                      <div className="text-[10px] text-neutral-500">{formatCOP(material.unit_cost_snapshot)} / {material.item?.unit || "und"}</div>
                    </td>
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
  highlighted,
  onStatus,
  onSubtaskStatus = () => undefined,
  onDelete,
  onConsume,
}: {
  task: ProductionTask;
  pending: boolean;
  highlighted?: boolean;
  onStatus: (task: ProductionTask, status: ProductionTaskStatus) => void;
  onSubtaskStatus?: (subtask: ProductionSubtask, status: ProductionTaskStatus) => void;
  onDelete?: (task: ProductionTask) => void;
  onConsume?: () => void;
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
  const statusSurface: Record<ProductionTaskStatus, string> = {
    pendiente: "bg-amber-50/70 border-amber-200",
    en_proceso: "bg-sky-50/70 border-sky-200",
    pausada: "bg-neutral-100 border-neutral-300",
    bloqueada: "bg-red-50/70 border-red-200",
    terminada: "bg-emerald-50/75 border-emerald-200",
    revisada: "bg-fuchsia-50/60 border-fuchsia-200",
    cancelada: "bg-neutral-50 border-neutral-200 opacity-70",
  };
  return (
    <div id={`task-${task.id}`} className={cn("task-row grid gap-3 rounded-2xl border border-l-4 px-3 py-3 shadow-sm transition hover:shadow-md sm:px-4 sm:py-4 md:grid-cols-[1fr_auto] md:items-center", statusAccent[task.status], statusSurface[task.status], highlighted && "task-row--highlighted")}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-neutral-950 px-2.5 py-1 font-mono text-xs font-black text-white">TP-{String(task.task_number || 0).padStart(4, "0")}</span>
          <StatusBadge status={task.status} />
          <PriorityBadge priority={task.priority} />
          {task.cost_center_code ? <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs font-bold text-neutral-600">{task.cost_center_code}</span> : null}
        </div>
        <div className="mt-2 text-lg font-black leading-tight text-neutral-950">{task.title}</div>
        <div className="task-row__facts mt-2 grid grid-cols-2 gap-2 text-xs text-neutral-600 lg:grid-cols-4">
          <TaskFact label="Creada por" value={createdByLabel(task.created_by)} />
          <TaskFact label="Responsable" value={task.assigned_to || "Sin responsable"} />
          <TaskFact label="Proceso" value={task.process_type} wideOnMobile />
          <TaskFact label="Tiempo aprox." value={formatEstimatedHours(task.estimated_minutes)} />
        </div>
        {task.notes ? <p className="mt-2 line-clamp-2 text-xs text-neutral-500">{task.notes}</p> : null}
        {task.attachments.length ? (
          <AttachmentLinks attachments={task.attachments} className="task-row__attachments" />
        ) : null}
        {task.subtasks.length ? (
          <details className="task-subtasks">
            <summary>
              <span>{task.subtasks.length} subtarea{task.subtasks.length === 1 ? "" : "s"}</span>
              <small>{task.subtasks.filter((subtask) => subtask.status === "terminada").length} terminadas</small>
            </summary>
            <div className="task-subtasks__list">
              {task.subtasks.map((subtask) => (
                <SubtaskRow
                  key={subtask.id}
                  subtask={subtask}
                  pending={pending}
                  onStatus={(status) => onSubtaskStatus(subtask, status)}
                />
              ))}
            </div>
          </details>
        ) : null}
      </div>
      <div className="task-row__actions grid grid-cols-2 gap-2 md:min-w-[210px] md:flex md:flex-wrap md:justify-end">
        {onConsume && !["revisada", "cancelada"].includes(task.status) ? (
          <button type="button" className="btn-quiet h-11 px-3 text-sm" disabled={pending} onClick={onConsume}>
            + Consumo
          </button>
        ) : null}
        {!task.subtasks.length && (task.status === "pendiente" || task.status === "pausada") ? (
          <button type="button" className="btn-secondary h-11 px-4 text-sm" disabled={pending} onClick={() => onStatus(task, "en_proceso")}>
            Iniciar
          </button>
        ) : null}
        {!task.subtasks.length && task.status === "en_proceso" ? (
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
        {onDelete ? (
          <button
            type="button"
            className="btn-danger h-11 px-3 text-sm"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`¿Eliminar la tarea TP-${String(task.task_number || 0).padStart(4, "0")} · ${task.title}?`)) onDelete(task);
            }}
          >
            Eliminar
          </button>
        ) : null}
      </div>
    </div>
  );
}

function SubtaskRow({
  subtask,
  pending,
  onStatus,
}: {
  subtask: ProductionSubtask;
  pending: boolean;
  onStatus: (status: ProductionTaskStatus) => void;
}) {
  const responsibleNames = subtask.assignments.map((assignment) => assignment.employee_name);
  return (
    <div className={cn("subtask-row", `subtask-row--${subtask.status}`)}>
      <div className="subtask-row__main">
        <div className="subtask-row__title">
          <StatusBadge status={subtask.status} />
          <strong>{subtask.title}</strong>
        </div>
        <div className="subtask-row__people">
          <span>Operarios</span>
          <b>{responsibleNames.length ? responsibleNames.join(", ") : "Sin asignar"}</b>
        </div>
        {subtask.notes ? <p>{subtask.notes}</p> : null}
        {subtask.attachments.length ? <AttachmentLinks attachments={subtask.attachments} /> : null}
      </div>
      <div className="subtask-row__actions">
        {["pendiente", "pausada"].includes(subtask.status) ? (
          <button type="button" className="btn-secondary" disabled={pending} onClick={() => onStatus("en_proceso")}>Iniciar</button>
        ) : null}
        {subtask.status === "en_proceso" ? (
          <>
            <button type="button" className="btn-secondary" disabled={pending} onClick={() => onStatus("pausada")}>Pausar</button>
            <button type="button" className="btn-primary" disabled={pending} onClick={() => onStatus("terminada")}>Terminar</button>
          </>
        ) : null}
      </div>
    </div>
  );
}

function AttachmentLinks({
  attachments,
  className,
}: {
  attachments: ProductionTask["attachments"];
  className?: string;
}) {
  return (
    <div className={cn("attachment-links", className)}>
      {attachments.map((attachment) => (
        attachment.url ? (
          <a key={attachment.id} href={attachment.url} target="_blank" rel="noreferrer" title={attachment.file_name}>
            <span aria-hidden="true">↗</span>{attachment.file_name}
          </a>
        ) : (
          <span key={attachment.id} className="attachment-links__unavailable">{attachment.file_name}</span>
        )
      ))}
    </div>
  );
}

function TaskFact({ label, value, wideOnMobile }: { label: string; value: string; wideOnMobile?: boolean }) {
  return (
    <div className={cn("rounded-xl bg-white/75 px-2.5 py-2", wideOnMobile && "col-span-2 lg:col-span-1")}>
      <div className="text-[10px] font-black uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="truncate text-sm font-bold text-neutral-800">{value}</div>
    </div>
  );
}

function RecentMovements({ movements }: { movements: InventoryMovement[] }) {
  return (
    <div className="recent-movements rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <h2 className="font-black text-neutral-950">Movimientos recientes</h2>
        <span className="text-xs text-neutral-500">{movements.length}</span>
      </div>
      <div className="recent-movements__list mt-3 max-h-[300px] divide-y divide-neutral-100 overflow-auto">
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

function WorkspaceToast({ feedback }: { feedback: NonNullable<Feedback> }) {
  return (
    <div
      className={cn("workspace-toast", `workspace-toast--${feedback.type}`)}
      role={feedback.type === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <span className="workspace-toast__dot" />
      <span>{feedback.text}</span>
    </div>
  );
}

function WorkspaceModalPanel({
  open,
  title,
  detail,
  onClose,
  wide,
  children,
}: {
  open: boolean;
  title: string;
  detail: string;
  onClose: () => void;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const [typing, setTyping] = useState(false);

  useEffect(() => {
    if (!open) {
      setTyping(false);
      return;
    }
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className={cn("workspace-modal", typing && "workspace-modal--typing")}
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
      onFocusCapture={(event) => {
        const target = event.target;
        const textInput = target instanceof HTMLInputElement && !["date", "checkbox", "radio", "hidden", "button", "submit"].includes(target.type);
        if (!textInput && !(target instanceof HTMLTextAreaElement)) return;
        setTyping(true);
        window.setTimeout(() => target.scrollIntoView({ block: "nearest", inline: "nearest" }), 220);
      }}
      onBlurCapture={() => {
        window.setTimeout(() => {
          const active = document.activeElement;
          const textInput = active instanceof HTMLInputElement && !["date", "checkbox", "radio", "hidden", "button", "submit"].includes(active.type);
          if (!textInput && !(active instanceof HTMLTextAreaElement)) setTyping(false);
        }, 0);
      }}
    >
      <section className={cn("workspace-modal__panel", wide && "workspace-modal__panel--wide")} role="dialog" aria-modal="true" aria-label={title}>
        <header className="workspace-modal__header">
          <div>
            <span>Accion rapida</span>
            <h2>{title}</h2>
            <p>{detail}</p>
          </div>
          <button type="button" className="workspace-modal__close" onClick={onClose} aria-label="Cerrar ventana">×</button>
        </header>
        <div className="workspace-modal__body">{children}</div>
      </section>
    </div>
  );
}

function TaskCreateForm({
  costCenters,
  employees,
  extensionsReady,
  pending,
  onSubmit,
  onCancel,
}: {
  costCenters: CostCenterOption[];
  employees: ProductionEmployeeOption[];
  extensionsReady: boolean;
  pending: boolean;
  onSubmit: (submission: TaskCreateSubmission) => void;
  onCancel: () => void;
}) {
  const assignableEmployees = useMemo(
    () => employees
      .filter((employee) => employee.roles.some((role) => ["operario", "ingeniero"].includes(role)))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );
  const [mainEmployeeIds, setMainEmployeeIds] = useState<string[]>([]);
  const [taskFiles, setTaskFiles] = useState<File[]>([]);
  const [subtasks, setSubtasks] = useState<DraftSubtask[]>([]);
  const [fileError, setFileError] = useState("");
  const steps = ["Trabajo", "Asignacion", "Subtareas", "Planeacion", "Confirmacion"];
  const wizard = useFormWizard(steps.length);

  const selectedCostCenter = costCenters.find((costCenter) => costCenter.code === wizard.review.cost_center_code);
  const selectedEmployeeNames = mainEmployeeIds
    .map((employeeId) => assignableEmployees.find((employee) => employee.id === employeeId)?.name)
    .filter((name): name is string => Boolean(name));
  const selectedPriority = priorityLabels[(wizard.review.priority || "media") as ProductionTaskPriority];
  const totalFiles = taskFiles.length + subtasks.reduce((sum, subtask) => sum + subtask.files.length, 0);

  function addSubtask() {
    setSubtasks((current) => [
      ...current,
      { id: crypto.randomUUID(), title: "", notes: "", employeeIds: [], files: [] },
    ]);
  }

  function updateSubtask(id: string, patch: Partial<DraftSubtask>) {
    setSubtasks((current) => current.map((subtask) => subtask.id === id ? { ...subtask, ...patch } : subtask));
  }

  function removeSubtask(id: string) {
    setSubtasks((current) => current.filter((subtask) => subtask.id !== id));
  }

  function setValidatedFiles(files: File[], apply: (files: File[]) => void, existingCount: number) {
    setFileError("");
    const tooLarge = files.find((file) => file.size > 8 * 1024 * 1024);
    if (tooLarge) {
      setFileError(`${tooLarge.name} supera el máximo de 8 MB.`);
      return;
    }
    if (totalFiles - existingCount + files.length > 20) {
      setFileError("Puedes adjuntar máximo 20 archivos por tarea.");
      return;
    }
    apply(files);
  }

  return (
    <form
      ref={wizard.formRef}
      className="modal-form task-wizard"
      onKeyDown={wizard.handleKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        if (wizard.step < steps.length - 1) {
          wizard.goNext();
          return;
        }
        const formData = new FormData(event.currentTarget);
        const subtaskInputs: ProductionSubtaskInput[] = subtasks.map((subtask) => ({
          title: subtask.title.trim(),
          notes: subtask.notes.trim() || null,
          assigned_to: subtask.employeeIds
            .map((employeeId) => assignableEmployees.find((employee) => employee.id === employeeId))
            .filter((employee): employee is ProductionEmployeeOption => Boolean(employee))
            .map((employee) => ({ employee_id: employee.id, employee_name: employee.name })),
        }));
        onSubmit({
          input: {
            title: textValue(formData, "title"),
            process_type: textValue(formData, "process_type"),
            cost_center_code: textValue(formData, "cost_center_code"),
            assigned_to: selectedEmployeeNames.join(", "),
            priority: textValue(formData, "priority") as ProductionTaskPriority,
            estimated_minutes: numberValue(formData, "estimated_hours") * 60,
            notes: textValue(formData, "notes"),
            subtasks: subtaskInputs,
          },
          taskFiles,
          subtaskFiles: subtasks.map((subtask) => subtask.files),
          fileCount: totalFiles,
        });
      }}
    >
      <WizardProgress steps={steps} currentStep={wizard.step} />

      <section className="task-wizard__step" data-wizard-step="0" hidden={wizard.step !== 0}>
        <WizardHeading eyebrow="Paso 1 de 5" title="¿Qué trabajo se necesita?" detail="Describe la tarea, selecciona el proceso y adjunta los archivos generales si los hay." />
        <Field name="title" label="Trabajo a realizar" placeholder="Ej. Soldar base de la maquina" required autoFocus />
        <SelectField name="process_type" label="Proceso" options={processOptions.map((process) => [process, process])} />
        {extensionsReady ? (
          <AttachmentPicker
            label="Adjuntos de la tarea (opcional)"
            detail="Planos, fotos, PDF, Word o Excel. Máximo 8 MB por archivo."
            files={taskFiles}
            onChange={(files) => setValidatedFiles(files, setTaskFiles, taskFiles.length)}
          />
        ) : null}
      </section>

      <section className="task-wizard__step" data-wizard-step="1" hidden={wizard.step !== 1}>
        <WizardHeading eyebrow="Paso 2 de 5" title="¿Para quién y quiénes son responsables?" detail="Busca el centro de costo y selecciona uno o varios operarios o ingenieros." />
        <ComboboxField name="cost_center_code" label="Centro de costo" options={costCenters.map((costCenter) => [costCenter.code, costCenterLabel(costCenter)])} placeholder="Escribe codigo, cliente o nombre..." />
        <EmployeeMultiSelect
          label="Responsables de la tarea (puedes escoger varios)"
          employees={assignableEmployees}
          value={mainEmployeeIds}
          onChange={setMainEmployeeIds}
        />
      </section>

      <section className="task-wizard__step" data-wizard-step="2" hidden={wizard.step !== 2}>
        <WizardHeading eyebrow="Paso 3 de 5 · Opcional" title="¿La tarea tiene subtareas?" detail="Agrégalas solo si necesitas dividir el trabajo. Cada una puede tener varios operarios y sus propios adjuntos." />
        {extensionsReady ? <div className="subtask-builder">
          {subtasks.length ? (
            <div className="subtask-builder__list">
              {subtasks.map((subtask, index) => (
                <div key={subtask.id} className="subtask-builder__card">
                  <div className="subtask-builder__header">
                    <strong>Subtarea {index + 1}</strong>
                    <button type="button" onClick={() => removeSubtask(subtask.id)}>Eliminar</button>
                  </div>
                  <div className="subtask-builder__fields">
                    <label className="block">
                      <span className="label">Trabajo de esta subtarea</span>
                      <input
                        className="input"
                        value={subtask.title}
                        onChange={(event) => updateSubtask(subtask.id, { title: event.target.value })}
                        placeholder="Ej. Cortar perfiles a la medida"
                        required
                      />
                    </label>
                    <label className="block">
                      <span className="label">Indicaciones (opcional)</span>
                      <input
                        className="input"
                        value={subtask.notes}
                        onChange={(event) => updateSubtask(subtask.id, { notes: event.target.value })}
                        placeholder="Medidas, acabado o cuidado especial"
                      />
                    </label>
                  </div>
                  <EmployeeMultiSelect
                    label="Responsables de esta subtarea (puedes escoger varios)"
                    employees={assignableEmployees}
                    value={subtask.employeeIds}
                    onChange={(employeeIds) => updateSubtask(subtask.id, { employeeIds })}
                  />
                  <AttachmentPicker
                    label="Adjuntos de esta subtarea (opcional)"
                    detail="Solo los archivos necesarios para este paso."
                    files={subtask.files}
                    compact
                    onChange={(files) => setValidatedFiles(
                      files,
                      (nextFiles) => updateSubtask(subtask.id, { files: nextFiles }),
                      subtask.files.length,
                    )}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="subtask-builder__empty">
              <strong>No es obligatorio dividir la tarea</strong>
              <span>Puedes continuar sin subtareas.</span>
            </div>
          )}
          <button type="button" className="btn-quiet subtask-builder__add" onClick={addSubtask}>
            + Agregar subtarea
          </button>
        </div> : (
          <div className="subtask-builder__empty">
            <strong>Subtareas y adjuntos pendientes de activar</strong>
            <span>Puedes crear la tarea general normalmente.</span>
          </div>
        )}
      </section>

      <section className="task-wizard__step" data-wizard-step="3" hidden={wizard.step !== 3}>
        <WizardHeading eyebrow="Paso 4 de 5" title="¿Cómo se debe planear?" detail="Define prioridad, tiempo e indicaciones generales." />
        <div className="modal-form__grid modal-form__grid--2">
          <SelectField name="priority" label="Prioridad" options={Object.entries(priorityLabels)} defaultValue="media" />
          <Field name="estimated_hours" label="Tiempo aprox. (horas)" type="number" step="1" min="1" placeholder="Ej. 2" />
        </div>
        <TextareaField name="notes" label="Indicaciones" placeholder="Material, medida, acabado o cuidado especial..." />
      </section>

      <section className="task-wizard__step" data-wizard-step="4" hidden={wizard.step !== 4}>
        <WizardHeading eyebrow="PASO FINAL · 5 DE 5" title="Confirma antes de crear" detail="Revisa la tarea, sus responsables, subtareas y archivos." />
        <div className="task-wizard__review">
          <div className="task-wizard__review-main">
            <span>Trabajo</span>
            <strong>{wizard.review.title || "Sin titulo"}</strong>
            <small>{wizard.review.process_type || "Sin proceso"}</small>
          </div>
          <ReviewItem label="Centro de costo" value={selectedCostCenter ? costCenterLabel(selectedCostCenter) : "Sin centro de costo"} />
          <ReviewItem label="Responsables" value={selectedEmployeeNames.join(", ") || "Sin responsables"} />
          <ReviewItem label="Prioridad" value={selectedPriority || "Media"} />
          <ReviewItem label="Tiempo aproximado" value={wizard.review.estimated_hours ? `${wizard.review.estimated_hours} h` : "Sin estimar"} />
          <ReviewItem label="Subtareas" value={subtasks.length ? `${subtasks.length} agregada${subtasks.length === 1 ? "" : "s"}` : "Sin subtareas"} />
          <ReviewItem label="Archivos" value={totalFiles ? `${totalFiles} adjunto${totalFiles === 1 ? "" : "s"}` : "Sin adjuntos"} />
          {subtasks.length ? (
            <div className="task-wizard__review-subtasks">
              <span>Distribución del trabajo</span>
              {subtasks.map((subtask, index) => (
                <div key={subtask.id}>
                  <strong>{index + 1}. {subtask.title}</strong>
                  <small>
                    {subtask.employeeIds
                      .map((employeeId) => assignableEmployees.find((employee) => employee.id === employeeId)?.name)
                      .filter(Boolean)
                      .join(", ") || "Sin operarios asignados"}
                  </small>
                </div>
              ))}
            </div>
          ) : null}
          {wizard.review.notes ? <div className="task-wizard__review-notes"><span>Indicaciones</span><p>{wizard.review.notes}</p></div> : null}
        </div>
        <div className="modal-hint"><strong>Paso final:</strong> al confirmar se subirán los adjuntos y la tarea quedará lista en el tablero.</div>
      </section>

      {fileError ? <div className="form-error" role="alert">{fileError}</div> : null}
      <WizardActions wizard={wizard} stepCount={steps.length} pending={pending} pendingLabel="Creando..." submitLabel="Confirmar y crear" onCancel={onCancel} />
    </form>
  );
}

function AttachmentPicker({
  label,
  detail,
  files,
  onChange,
  compact,
}: {
  label: string;
  detail: string;
  files: File[];
  onChange: (files: File[]) => void;
  compact?: boolean;
}) {
  const inputId = useId();
  return (
    <div className={cn("attachment-picker", compact && "attachment-picker--compact")}>
      <div>
        <span className="label">{label}</span>
        <small>{detail}</small>
      </div>
      <label htmlFor={inputId} className="attachment-picker__button">
        <span aria-hidden="true">+</span> Elegir archivos
      </label>
      <input
        id={inputId}
        className="attachment-picker__input"
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt"
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          if (selected.length) onChange([...files, ...selected]);
          event.target.value = "";
        }}
      />
      {files.length ? (
        <div className="attachment-picker__files">
          {files.map((file, index) => (
            <span key={`${file.name}-${file.size}-${index}`}>
              <b>{file.name}</b>
              <small>{formatFileSize(file.size)}</small>
              <button type="button" aria-label={`Quitar ${file.name}`} onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}>×</button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EmployeeMultiSelect({
  label,
  employees,
  value,
  onChange,
}: {
  label: string;
  employees: ProductionEmployeeOption[];
  value: string[];
  onChange: (employeeIds: string[]) => void;
}) {
  return (
    <div className="employee-multi-select">
      <div className="employee-multi-select__heading">
        <span className="label">{label}</span>
        <small>{value.length ? `${value.length} seleccionado${value.length === 1 ? "" : "s"}` : "Selección opcional"}</small>
      </div>
      <div className="employee-check-grid">
        {employees.map((employee) => {
          const checked = value.includes(employee.id);
          return (
            <label key={employee.id} className={cn("employee-check", checked && "is-selected")}>
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onChange(
                  checked
                    ? value.filter((employeeId) => employeeId !== employee.id)
                    : [...value, employee.id],
                )}
              />
              <span>{employee.name}</span>
            </label>
          );
        })}
        {!employees.length ? <small>No hay operarios o ingenieros disponibles.</small> : null}
      </div>
    </div>
  );
}

function WizardHeading({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) {
  return (
    <div className="task-wizard__heading">
      <span>{eyebrow}</span>
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function ReviewItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="task-wizard__review-item">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function useFormWizard(stepCount: number) {
  const formRef = useRef<HTMLFormElement>(null);
  const [step, setStep] = useState(0);
  const [review, setReview] = useState<Record<string, string>>({});

  useEffect(() => {
    if (step >= stepCount - 1) return;
    const frame = window.requestAnimationFrame(() => {
      formRef.current
        ?.querySelector<HTMLElement>(`[data-wizard-step="${step}"] input:not([type="hidden"]), [data-wizard-step="${step}"] select, [data-wizard-step="${step}"] textarea`)
        ?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [step, stepCount]);

  function goNext() {
    const form = formRef.current;
    const panel = form?.querySelector<HTMLElement>(`[data-wizard-step="${step}"]`);
    const controls = panel
      ? Array.from(panel.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input:not([type='hidden']), select, textarea"))
      : [];
    const invalidControl = controls.find((control) => !control.checkValidity());

    if (invalidControl) {
      invalidControl.reportValidity();
      invalidControl.focus();
      return;
    }

    if (form && step === stepCount - 2) {
      setReview(Object.fromEntries(
        Array.from(new FormData(form).entries(), ([key, value]) => [key, String(value)]),
      ));
    }
    setStep((current) => Math.min(stepCount - 1, current + 1));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLFormElement>) {
    const target = event.target as HTMLElement;
    if (event.key !== "Enter" || step >= stepCount - 1 || target.tagName === "TEXTAREA" || target.getAttribute("role") === "combobox") return;
    event.preventDefault();
    goNext();
  }

  return {
    formRef,
    step,
    review,
    goNext,
    handleKeyDown,
    goBack: () => setStep((current) => Math.max(0, current - 1)),
  };
}

function WizardProgress({ steps, currentStep }: { steps: string[]; currentStep: number }) {
  return (
    <div className="task-wizard__progress" aria-label={`Paso ${currentStep + 1} de ${steps.length}`}>
      {steps.map((label, index) => (
        <div key={label} className={cn("task-wizard__progress-item", index === currentStep && "is-active", index < currentStep && "is-complete")}>
          <span>{index < currentStep ? "✓" : index + 1}</span>
          <strong>{label}</strong>
        </div>
      ))}
    </div>
  );
}

function WizardActions({
  wizard,
  stepCount,
  pending,
  pendingLabel,
  submitLabel,
  onCancel,
}: {
  wizard: ReturnType<typeof useFormWizard>;
  stepCount: number;
  pending: boolean;
  pendingLabel: string;
  submitLabel: string;
  onCancel: () => void;
}) {
  return (
    <div className="modal-actions task-wizard__actions">
      <button type="button" className="btn-secondary" disabled={pending} onClick={onCancel}>Cancelar</button>
      <div className="task-wizard__action-group">
        {wizard.step > 0 ? <button type="button" className="btn-secondary" disabled={pending} onClick={wizard.goBack}>Atras</button> : null}
        {wizard.step < stepCount - 1 ? (
          <button type="button" className="btn-primary" onClick={wizard.goNext}>Siguiente <span aria-hidden="true">→</span></button>
        ) : (
          <button type="submit" className="btn-primary" disabled={pending}>{pending ? pendingLabel : submitLabel}</button>
        )}
      </div>
    </div>
  );
}

function ConsumptionForm({
  tasks,
  items,
  defaultTaskId,
  pending,
  onSubmit,
  onCancel,
}: {
  tasks: ProductionTask[];
  items: InventoryItem[];
  defaultTaskId: string;
  pending: boolean;
  onSubmit: (input: Parameters<typeof consumeProductionMaterials>[0]) => void;
  onCancel: () => void;
}) {
  const [taskId, setTaskId] = useState(defaultTaskId);
  const [error, setError] = useState("");
  const [rows, setRows] = useState<Array<{ itemId: string; quantity: number }>>([]);
  const selectedTask = tasks.find((task) => task.id === taskId);
  const fixedTask = Boolean(defaultTaskId);
  const availableItems = items.filter((item) => item.stock > 0 && !rows.some((row) => row.itemId === item.id));

  function addItem(itemId: string) {
    if (!itemId) return;
    setError("");
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) {
      setError("Ese material ya no está disponible.");
      return;
    }
    if (item.stock <= 0) {
      setError(`${item.name} no tiene existencias disponibles.`);
      return;
    }
    setRows((current) => [...current, { itemId: item.id, quantity: Math.min(1, item.stock) }]);
    window.setTimeout(() => document.getElementById(`consumption-quantity-${item.id}`)?.focus(), 0);
  }

  return (
    <form
      className="modal-form consumption-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");
        if (!taskId) {
          setError("Selecciona la tarea a la que pertenecen los consumos.");
          return;
        }
        if (!rows.length) {
          setError("Agrega al menos un material a la tabla.");
          return;
        }
        if (rows.some((row) => !Number.isFinite(row.quantity) || row.quantity <= 0)) {
          setError("Revisa las cantidades de la tabla.");
          return;
        }
        const rowWithoutStock = rows.find((row) => {
          const item = items.find((candidate) => candidate.id === row.itemId);
          return !item || row.quantity > item.stock;
        });
        if (rowWithoutStock) {
          const item = items.find((candidate) => candidate.id === rowWithoutStock.itemId);
          setError(item ? `No hay stock suficiente de ${item.name}. Disponible: ${formatQuantity(item.stock)} ${item.unit}.` : "Uno de los materiales ya no está disponible.");
          return;
        }
        onSubmit({
          task_id: taskId,
          items: rows.map((row) => ({ item_id: row.itemId, quantity: row.quantity })),
          notes: null,
        });
      }}
    >
      {!fixedTask ? (
        <label className="block">
          <span className="label">Tarea de producción</span>
          <select value={taskId} onChange={(event) => setTaskId(event.target.value)} className="input" required>
            <option value="">Selecciona la tarea...</option>
            {tasks.map((task) => <option key={task.id} value={task.id}>{taskLabel(task)}</option>)}
          </select>
        </label>
      ) : null}

      <div className="consumption-simple-search">
        <div className="consumption-simple-search__heading">
          <div>
            <strong>Agregar materiales</strong>
            <span>Busca y toca un ítem; se agregará directamente a la tabla.</span>
          </div>
          {fixedTask ? <small>{selectedTask ? taskLabel(selectedTask) : "Tarea seleccionada"}</small> : null}
        </div>
        <div>
          <span className="label">Buscar material</span>
          <InventoryItemPicker items={availableItems} value="" onChange={addItem} />
        </div>
      </div>

      {error ? <div className="consumption-form__error" role="alert">{error}</div> : null}

      <div className="consumption-draft">
        <div className="consumption-draft__heading">
          <div>
            <strong>Materiales a consumir</strong>
            <span>Puedes corregir cantidades antes de guardar.</span>
          </div>
          <b>{rows.length}</b>
        </div>
        {rows.length ? (
          <div className="consumption-draft__table">
            <table>
              <thead>
                <tr>
                  <th>Material</th>
                  <th>Cantidad consumida</th>
                  <th>Disponible</th>
                  <th><span className="sr-only">Quitar</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const item = items.find((candidate) => candidate.id === row.itemId);
                  if (!item) return null;
                  return (
                    <tr key={row.itemId}>
                      <td>
                        <strong>{item.name}</strong>
                        <span>{item.code}</span>
                      </td>
                      <td>
                        <div className="consumption-row-quantity">
                          <input
                            id={`consumption-quantity-${item.id}`}
                            type="number"
                            min="0.001"
                            max={item.stock}
                            step="0.001"
                            inputMode="decimal"
                            value={row.quantity}
                            onChange={(event) => {
                              const nextQuantity = Number(event.target.value);
                              setRows((current) => current.map((currentRow) => currentRow.itemId === row.itemId ? { ...currentRow, quantity: nextQuantity } : currentRow));
                            }}
                            aria-label={`Cantidad consumida de ${item.name}`}
                          />
                          <b>{item.unit}</b>
                        </div>
                      </td>
                      <td>{formatQuantity(item.stock)} {item.unit}</td>
                      <td>
                        <button type="button" className="consumption-remove" onClick={() => setRows((current) => current.filter((currentRow) => currentRow.itemId !== row.itemId))} aria-label={`Quitar ${item.name}`}>×</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="consumption-draft__empty">Busca y toca un material para agregarlo aquí.</div>
        )}
      </div>

      <div className="modal-actions consumption-form__actions">
        <button type="button" className="btn-secondary" disabled={pending} onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn-primary" disabled={pending || !rows.length}>{pending ? "Guardando..." : `Guardar ${rows.length || ""} consumo${rows.length === 1 ? "" : "s"}`}</button>
      </div>
    </form>
  );
}

function InventoryItemPicker({
  items,
  value,
  onChange,
}: {
  items: InventoryItem[];
  value: string;
  onChange: (value: string) => void;
}) {
  const inputId = useId();
  const listboxId = `${inputId}-inventory-options`;
  const selectedItem = items.find((item) => item.id === value);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const normalizedQuery = normalizeSearchText(query);
  const filteredItems = useMemo(() => {
    const matches = normalizedQuery
      ? items.filter((item) => normalizeSearchText(`${item.code} ${item.name} ${item.category} ${item.location || ""}`).includes(normalizedQuery))
      : items;
    return matches.slice(0, 12);
  }, [items, normalizedQuery]);

  useEffect(() => {
    if (!value) setQuery("");
    else if (selectedItem) setQuery(`${selectedItem.code} - ${selectedItem.name}`);
  }, [selectedItem, value]);

  function choose(item: InventoryItem) {
    onChange(item.id);
    setQuery(`${item.code} - ${item.name}`);
    setOpen(false);
    setActiveIndex(-1);
  }

  return (
    <div
      className="combobox-field consumption-item-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div className="combobox-control">
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          value={query}
          placeholder="Escribe código o nombre..."
          className="input combobox-input"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            onChange("");
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => Math.min(filteredItems.length - 1, current + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter" && open && filteredItems.length) {
              event.preventDefault();
              choose(filteredItems[activeIndex >= 0 ? activeIndex : 0]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        <button type="button" className="combobox-toggle" aria-label="Mostrar materiales" onMouseDown={(event) => event.preventDefault()} onClick={() => setOpen((current) => !current)}>▾</button>
      </div>
      {open ? (
        <div id={listboxId} className="combobox-options" role="listbox">
          {filteredItems.length ? filteredItems.map((item, index) => (
            <button
              key={item.id}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={value === item.id}
              className={cn(activeIndex === index && "is-active")}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(item)}
            >
              <strong>{item.code}</strong>
              <span>{item.name} · {formatQuantity(item.stock)} {item.unit}</span>
            </button>
          )) : <div className="combobox-empty">No hay materiales que coincidan.</div>}
        </div>
      ) : null}
    </div>
  );
}

function InventoryItemEditForm({
  item,
  suppliers,
  pending,
  onSubmit,
  onCancel,
}: {
  item: InventoryItem;
  suppliers: Supplier[];
  pending: boolean;
  onSubmit: (input: Parameters<typeof updateInventoryItem>[1]) => void;
  onCancel: () => void;
}) {
  return (
    <form
      className="modal-form inventory-edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        onSubmit({
          name: textValue(formData, "name"),
          category: textValue(formData, "category"),
          unit: textValue(formData, "unit"),
          stock: numberValue(formData, "stock"),
          min_stock: numberValue(formData, "min_stock"),
          location: textValue(formData, "location"),
          preferred_supplier_id: textValue(formData, "preferred_supplier_id"),
        });
      }}
    >
      <div className="inventory-edit-form__identity">
        <span>Item</span>
        <strong>{item.name}</strong>
        <small>{item.code}</small>
      </div>
      <div className="modal-form__grid modal-form__grid--3">
        <Field name="name" label="Nombre del material" defaultValue={item.name} required autoFocus />
        <Field name="category" label="Categoria" defaultValue={item.category} />
        <Field name="unit" label="Unidad" defaultValue={item.unit} placeholder="und, m, kg" />
      </div>
      <div className="inventory-edit-form__stock">
        <div>
          <span>Corrige la existencia real</span>
          <strong>La diferencia quedará registrada como ajuste.</strong>
        </div>
        <Field name="stock" label={`Cantidad disponible (${item.unit})`} type="number" step="0.001" min="0" defaultValue={String(item.stock)} required />
        <Field name="min_stock" label="Stock minimo" type="number" step="0.001" min="0" defaultValue={String(item.min_stock)} />
      </div>
      <div className="modal-form__grid modal-form__grid--2">
        <Field name="location" label="Ubicacion" defaultValue={item.location || ""} placeholder="Bodega, estante..." />
        <SelectField
          name="preferred_supplier_id"
          label="Proveedor preferido"
          options={suppliers.map((supplier) => [supplier.id, supplierLabel(supplier)])}
          blank="Sin proveedor fijo"
          defaultValue={item.preferred_supplier_id || ""}
        />
      </div>
      <div className="modal-actions">
        <button type="button" className="btn-secondary" disabled={pending} onClick={onCancel}>Cancelar</button>
        <button type="submit" className="btn-primary" disabled={pending}>{pending ? "Guardando..." : "Guardar cambios"}</button>
      </div>
    </form>
  );
}

function InventoryItemForm({
  suppliers,
  pending,
  onSubmit,
  onCancel,
}: {
  suppliers: Supplier[];
  pending: boolean;
  onSubmit: (input: Parameters<typeof createInventoryItem>[0]) => void;
  onCancel: () => void;
}) {
  const steps = ["Material", "Organizacion", "Inventario", "Confirmar"];
  const wizard = useFormWizard(steps.length);
  const selectedSupplier = suppliers.find((supplier) => supplier.id === wizard.review.preferred_supplier_id);

  return (
    <form
      ref={wizard.formRef}
      className="modal-form task-wizard"
      onKeyDown={wizard.handleKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        if (wizard.step < steps.length - 1) {
          wizard.goNext();
          return;
        }
        const formData = new FormData(event.currentTarget);
        onSubmit({
          code: textValue(formData, "code"),
          name: textValue(formData, "name"),
          category: textValue(formData, "category"),
          unit: textValue(formData, "unit"),
          stock: numberValue(formData, "stock"),
          min_stock: numberValue(formData, "min_stock"),
          location: textValue(formData, "location"),
          preferred_supplier_id: textValue(formData, "preferred_supplier_id"),
        });
      }}
    >
      <WizardProgress steps={steps} currentStep={wizard.step} />

      <section className="task-wizard__step" data-wizard-step="0" hidden={wizard.step !== 0}>
        <WizardHeading eyebrow="Paso 1 de 4" title="¿Que material vas a crear?" detail="Escribe un nombre claro y un codigo facil de reconocer." />
        <Field name="name" label="Nombre del material" placeholder="Tubo SCH40, lamina, pintura..." required autoFocus />
        <Field name="code" label="Codigo" placeholder="INV-0001" />
      </section>

      <section className="task-wizard__step" data-wizard-step="1" hidden={wizard.step !== 1}>
        <WizardHeading eyebrow="Paso 2 de 4" title="¿Como se organiza?" detail="Indica su categoria, unidad de medida y ubicacion en planta." />
      <div className="modal-form__grid modal-form__grid--3">
        <Field name="category" label="Categoria" placeholder="Perfil, rodamiento..." />
        <Field name="unit" label="Unidad" placeholder="und, m, kg" defaultValue="und" />
        <Field name="location" label="Ubicacion" placeholder="Bodega, estante..." />
      </div>
      </section>

      <section className="task-wizard__step" data-wizard-step="2" hidden={wizard.step !== 2}>
        <WizardHeading eyebrow="Paso 3 de 4" title="¿Con cuánto inventario inicia?" detail="Registra existencias, nivel mínimo y proveedor si ya los conoces." />
        <div className="modal-form__grid modal-form__grid--2">
          <Field name="stock" label="Stock inicial" type="number" step="0.001" min="0" defaultValue="0" />
          <Field name="min_stock" label="Stock minimo" type="number" step="0.001" min="0" defaultValue="0" />
        </div>
        <SelectField name="preferred_supplier_id" label="Proveedor preferido" options={suppliers.map((supplier) => [supplier.id, supplierLabel(supplier)])} blank="Sin proveedor fijo" />
      </section>

      <section className="task-wizard__step" data-wizard-step="3" hidden={wizard.step !== 3}>
        <WizardHeading eyebrow="Paso 4 de 4" title="Revisa el nuevo item" detail="Confirma que el material quede identificado y ubicado correctamente." />
        <div className="task-wizard__review">
          <div className="task-wizard__review-main">
            <span>Material</span>
            <strong>{wizard.review.name || "Sin nombre"}</strong>
            <small>{wizard.review.code || "Codigo automatico"}</small>
          </div>
          <ReviewItem label="Categoria" value={wizard.review.category || "Sin categoria"} />
          <ReviewItem label="Unidad" value={wizard.review.unit || "und"} />
          <ReviewItem label="Ubicacion" value={wizard.review.location || "Sin ubicacion"} />
          <ReviewItem label="Stock inicial" value={wizard.review.stock || "0"} />
          <ReviewItem label="Stock minimo" value={wizard.review.min_stock || "0"} />
          <ReviewItem label="Proveedor" value={selectedSupplier ? supplierLabel(selectedSupplier) : "Sin proveedor fijo"} />
        </div>
      </section>

      <WizardActions wizard={wizard} stepCount={steps.length} pending={pending} pendingLabel="Guardando..." submitLabel="Guardar item" onCancel={onCancel} />
    </form>
  );
}

function InventoryMovementForm({
  items,
  costCenters,
  pending,
  onSubmit,
  onCancel,
}: {
  items: InventoryItem[];
  costCenters: CostCenterOption[];
  pending: boolean;
  onSubmit: (input: Parameters<typeof createInventoryMovement>[0]) => void;
  onCancel: () => void;
}) {
  const steps = ["Movimiento", "Cantidad", "Detalle", "Confirmar"];
  const wizard = useFormWizard(steps.length);
  const selectedItem = items.find((item) => item.id === wizard.review.item_id);
  const selectedCostCenter = costCenters.find((costCenter) => costCenter.code === wizard.review.cost_center_code);
  const movementLabels: Record<InventoryMovementType, string> = { entrada: "Entrada", salida: "Salida", ajuste: "Ajuste" };
  const selectedMovement = movementLabels[(wizard.review.movement_type || "entrada") as InventoryMovementType];

  return (
    <form
      ref={wizard.formRef}
      className="modal-form task-wizard"
      onKeyDown={wizard.handleKeyDown}
      onSubmit={(event) => {
        event.preventDefault();
        if (wizard.step < steps.length - 1) {
          wizard.goNext();
          return;
        }
        const formData = new FormData(event.currentTarget);
        onSubmit({
          item_id: textValue(formData, "item_id"),
          movement_type: textValue(formData, "movement_type") as InventoryMovementType,
          quantity: numberValue(formData, "quantity"),
          unit_cost: numberValue(formData, "unit_cost"),
          cost_center_code: textValue(formData, "cost_center_code"),
          notes: textValue(formData, "notes"),
          movement_date: textValue(formData, "movement_date"),
        });
      }}
    >
      <WizardProgress steps={steps} currentStep={wizard.step} />

      <section className="task-wizard__step" data-wizard-step="0" hidden={wizard.step !== 0}>
        <WizardHeading eyebrow="Paso 1 de 4" title="¿Que movimiento vas a registrar?" detail="Selecciona el material y si entra, sale o se ajusta su inventario." />
        <SelectField name="item_id" label="Item de inventario" options={items.map((item) => [item.id, `${item.code} - ${item.name}`])} blank="Selecciona item..." required autoFocus />
        <SelectField name="movement_type" label="Tipo" options={[["entrada", "Entrada"], ["salida", "Salida"], ["ajuste", "Ajuste"]]} />
      </section>

      <section className="task-wizard__step" data-wizard-step="1" hidden={wizard.step !== 1}>
        <WizardHeading eyebrow="Paso 2 de 4" title="¿Que cantidad y costo tiene?" detail="Indica cuanto material se mueve y su costo unitario cuando corresponda." />
        <div className="modal-form__grid modal-form__grid--2">
        <Field name="quantity" label="Cantidad" type="number" step="0.001" min="0.001" required />
        <Field name="unit_cost" label="Costo unitario" type="number" step="0.01" min="0" />
        </div>
      </section>

      <section className="task-wizard__step" data-wizard-step="2" hidden={wizard.step !== 2}>
        <WizardHeading eyebrow="Paso 3 de 4" title="¿A donde se carga?" detail="Busca el centro de costo, confirma la fecha y agrega una nota si hace falta." />
        <div className="modal-form__grid modal-form__grid--2">
        <ComboboxField name="cost_center_code" label="Centro de costo" options={costCenters.map((costCenter) => [costCenter.code, costCenterLabel(costCenter)])} placeholder="Escribe para buscar..." />
        <Field name="movement_date" label="Fecha" type="date" defaultValue={todayInputValue()} />
        </div>
        <Field name="notes" label="Nota" placeholder="Compra, ajuste, salida manual..." />
      </section>

      <section className="task-wizard__step" data-wizard-step="3" hidden={wizard.step !== 3}>
        <WizardHeading eyebrow="Paso 4 de 4" title="Confirma el movimiento" detail="Revisa la operacion antes de cambiar las existencias del inventario." />
        <div className="task-wizard__review">
          <div className="task-wizard__review-main">
            <span>Item</span>
            <strong>{selectedItem ? `${selectedItem.code} - ${selectedItem.name}` : "Sin item"}</strong>
            <small>{selectedMovement}</small>
          </div>
          <ReviewItem label="Cantidad" value={`${wizard.review.quantity || "0"} ${selectedItem?.unit || ""}`.trim()} />
          <ReviewItem label="Costo unitario" value={wizard.review.unit_cost ? formatCOP(Number(wizard.review.unit_cost)) : "Sin costo"} />
          <ReviewItem label="Fecha" value={wizard.review.movement_date || todayInputValue()} />
          <ReviewItem label="Centro de costo" value={selectedCostCenter ? costCenterLabel(selectedCostCenter) : "Sin centro de costo"} />
          {wizard.review.notes ? <div className="task-wizard__review-notes"><span>Nota</span><p>{wizard.review.notes}</p></div> : null}
        </div>
        <div className="modal-hint">Al confirmar se actualizara inmediatamente el inventario del item.</div>
      </section>

      <WizardActions wizard={wizard} stepCount={steps.length} pending={pending} pendingLabel="Registrando..." submitLabel="Registrar movimiento" onCancel={onCancel} />
    </form>
  );
}

function Panel({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return (
    <section className="workspace-panel rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="mb-3">
        <h2 className="font-black text-neutral-950">{title}</h2>
        {detail ? <p className="text-xs text-neutral-500">{detail}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SectionStat({ value, label, tone }: { value: number; label: string; tone: "magenta" | "amber" }) {
  return (
    <div className={cn("section-toolbar__stat", `section-toolbar__stat--${tone}`)}>
      <strong>{value}</strong>
      <span>{label}</span>
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
  min,
  defaultValue,
  autoFocus,
}: {
  name: string;
  label: string;
  type?: string;
  placeholder?: string;
  required?: boolean;
  step?: string;
  min?: string;
  defaultValue?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <input name={name} type={type} required={required} step={step} min={min} defaultValue={defaultValue} placeholder={placeholder} autoFocus={autoFocus} className="input" />
    </label>
  );
}

function TextareaField({ name, label, placeholder }: { name: string; label: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <textarea name={name} placeholder={placeholder} rows={2} className="input resize-y" />
    </label>
  );
}

function ComboboxField({
  name,
  label,
  options,
  placeholder,
  required,
}: {
  name: string;
  label: string;
  options: Array<[string, string]>;
  placeholder?: string;
  required?: boolean;
}) {
  const inputId = useId();
  const listboxId = `${inputId}-options`;
  const [query, setQuery] = useState("");
  const [selectedValue, setSelectedValue] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const normalizedQuery = normalizeSearchText(query);
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) return options.slice(0, 10);
    return options
      .filter(([value, optionLabel]) => normalizeSearchText(`${value} ${optionLabel}`).includes(normalizedQuery))
      .slice(0, 10);
  }, [normalizedQuery, options]);

  function chooseOption(option: [string, string]) {
    setSelectedValue(option[0]);
    setQuery(option[1]);
    setOpen(false);
    setActiveIndex(-1);
  }

  function resolveExactValue(value: string) {
    const normalized = normalizeSearchText(value);
    return options.find(([optionValue, optionLabel]) =>
      normalizeSearchText(optionValue) === normalized || normalizeSearchText(optionLabel) === normalized,
    );
  }

  return (
    <div
      className="combobox-field"
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        const exact = resolveExactValue(query);
        if (exact) chooseOption(exact);
        else setOpen(false);
      }}
    >
      <label htmlFor={inputId} className="label">{label}</label>
      <div className="combobox-control">
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined}
          required={required}
          value={query}
          placeholder={placeholder}
          className="input combobox-input"
          autoComplete="off"
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            const nextQuery = event.target.value;
            const exact = resolveExactValue(nextQuery);
            setQuery(nextQuery);
            setSelectedValue(exact?.[0] ?? "");
            setActiveIndex(-1);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((current) => Math.min(filteredOptions.length - 1, current + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter" && open && activeIndex >= 0 && filteredOptions[activeIndex]) {
              event.preventDefault();
              chooseOption(filteredOptions[activeIndex]);
            } else if (event.key === "Escape") {
              setOpen(false);
              setActiveIndex(-1);
            }
          }}
        />
        <button
          type="button"
          className="combobox-toggle"
          aria-label={open ? "Cerrar opciones" : "Mostrar opciones"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen((current) => !current);
            document.getElementById(inputId)?.focus();
          }}
        >
          ▾
        </button>
      </div>
      <input type="hidden" name={name} value={selectedValue} />
      {open ? (
        <div id={listboxId} className="combobox-options" role="listbox">
          {filteredOptions.length ? filteredOptions.map((option, index) => (
            <button
              key={option[0]}
              id={`${listboxId}-${index}`}
              type="button"
              role="option"
              aria-selected={selectedValue === option[0]}
              className={cn(activeIndex === index && "is-active")}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => chooseOption(option)}
            >
              <strong>{option[0]}</strong>
              <span>{option[1].replace(`${option[0]} - `, "")}</span>
            </button>
          )) : (
            <div className="combobox-empty">No hay centros de costo que coincidan.</div>
          )}
        </div>
      ) : null}
      {query && !selectedValue ? <div className="combobox-help">Selecciona una coincidencia para guardar el centro de costo.</div> : null}
    </div>
  );
}

function SelectField({
  name,
  label,
  options,
  blank,
  required,
  defaultValue,
  autoFocus,
}: {
  name: string;
  label: string;
  options: Array<[string, string]>;
  blank?: string;
  required?: boolean;
  defaultValue?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      <select name={name} required={required} defaultValue={defaultValue} autoFocus={autoFocus} className="input">
        {blank ? <option value="">{blank}</option> : null}
        {options.map(([value, labelText]) => (
          <option key={value} value={value}>{labelText}</option>
        ))}
      </select>
    </label>
  );
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

async function createProductionTaskWithUploads(submission: TaskCreateSubmission): Promise<string> {
  const supabase = createBrowserClient();
  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) throw new Error("Tu sesión venció. Vuelve a ingresar.");

  const uploadedPaths: string[] = [];
  const draftFolder = crypto.randomUUID();
  const uploadFiles = async (files: File[], scope: string) => {
    const uploaded = [];
    for (const [index, file] of files.entries()) {
      if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} supera el máximo de 8 MB.`);
      const cleanName = sanitizeUploadFileName(file.name);
      const bucketPath = `${user.id}/${draftFolder}/${scope}/${String(index + 1).padStart(2, "0")}-${crypto.randomUUID()}-${cleanName}`;
      const { error } = await supabase.storage
        .from("production-task-attachments")
        .upload(bucketPath, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (error) throw new Error(`No se pudo subir ${file.name}. ${error.message}`);
      uploadedPaths.push(bucketPath);
      uploaded.push({
        bucket_path: bucketPath,
        file_name: file.name,
        content_type: file.type || null,
        size_bytes: file.size,
      });
    }
    return uploaded;
  };

  try {
    const taskAttachments = await uploadFiles(submission.taskFiles, "principal");
    const subtasks = [];
    for (const [index, subtask] of (submission.input.subtasks ?? []).entries()) {
      subtasks.push({
        ...subtask,
        attachments: await uploadFiles(submission.subtaskFiles[index] ?? [], `subtarea-${index + 1}`),
      });
    }
    return await createProductionTask({
      ...submission.input,
      attachments: taskAttachments,
      subtasks,
    });
  } catch (error) {
    if (uploadedPaths.length) {
      await supabase.storage.from("production-task-attachments").remove(uploadedPaths);
    }
    throw error;
  }
}

function sanitizeUploadFileName(value: string): string {
  const cleanValue = normalizeSearchText(value)
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleanValue || "archivo";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function textValue(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function numberValue(formData: FormData, key: string): number {
  const raw = textValue(formData, key);
  if (!raw) return 0;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : 0;
}

function formatEstimatedHours(minutes: number): string {
  if (!minutes || minutes <= 0) return "Sin estimar";
  const hours = Math.round((minutes / 60) * 100) / 100;
  return `${formatQuantity(hours)} h`;
}

function supplierLabel(supplier: Supplier): string {
  return `${supplier.name}${supplier.nit ? ` - ${supplier.nit}` : ""}`;
}

function costCenterLabel(costCenter: CostCenterOption): string {
  const name = costCenter.name || costCenter.client_name;
  return `${costCenter.code}${name ? ` - ${name}` : ""}`;
}

function createdByLabel(value: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "Sin registro";
  const localPart = raw.includes("@") ? raw.split("@")[0] : raw;
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function taskBelongsToUser(task: ProductionTask, email: string, userName: string): boolean {
  const normalizedEmail = normalizeSearchText(email);
  if (normalizedEmail && normalizeSearchText(task.created_by || "") === normalizedEmail) return true;

  const assignedWords = new Set(normalizeSearchText(task.assigned_to || "").split(/[^a-z0-9]+/).filter(Boolean));
  const identityTokens = normalizeSearchText(`${userName} ${email.split("@")[0]}`)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !["usuario", "produccion", "tecondor"].includes(token));
  if (identityTokens.some((token) => assignedWords.has(token))) return true;

  const subtaskAssignmentWords = new Set(
    (task.subtasks ?? [])
      .flatMap((subtask) => subtask.assignments ?? [])
      .flatMap((assignment) => normalizeSearchText(assignment.employee_name).split(/[^a-z0-9]+/))
      .filter(Boolean),
  );
  return identityTokens.some((token) => subtaskAssignmentWords.has(token));
}

function taskLabel(task: ProductionTask): string {
  return `TP-${String(task.task_number || 0).padStart(4, "0")} - ${task.title}`;
}

function todayInputValue(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function normalizeSearchText(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("es").trim();
}
