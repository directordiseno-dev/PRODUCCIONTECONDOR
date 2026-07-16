"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type {
  CostCenterOption,
  InventoryItem,
  InventoryItemInput,
  InventoryMovement,
  InventoryMovementInput,
  ProductionMaterialConsumptionInput,
  ProductionEmployeeOption,
  ProductionEmployeeRole,
  ProductionTask,
  ProductionTaskInput,
  ProductionTaskMaterial,
  ProductionTaskStatus,
  ProductionWorkspaceData,
  Supplier,
} from "@/lib/types";

type SupabaseError = { message?: string; code?: string; hint?: string | null; details?: string | null };

export async function listProductionWorkspaceData(): Promise<ProductionWorkspaceData> {
  const supabase = await createClient();

  const [itemsRes, tasksRes, movementsRes, materialsRes, centersRes, suppliersRes, employeesRes] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("*, preferred_supplier:suppliers(*)")
      .order("active", { ascending: false })
      .order("name", { ascending: true })
      .limit(500),
    supabase
      .from("production_tasks")
      .select("*")
      .neq("status", "cancelada")
      .order("created_at", { ascending: false })
      .limit(120),
    supabase
      .from("inventory_movements")
      .select("*, item:inventory_items(*), task:production_tasks(*)")
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(120),
    supabase
      .from("production_task_materials")
      .select("*, item:inventory_items(*), task:production_tasks(*)")
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("cost_centers")
      .select("code,name,client_name,type")
      .neq("status", "anulado")
      .order("code"),
    supabase
      .from("suppliers")
      .select("*")
      .order("name")
      .limit(800),
    supabase
      .from("payroll_employees")
      .select("id,name,production_roles")
      .eq("deleted", false)
      .order("name")
      .limit(200),
  ]);

  const firstSchemaError = [itemsRes.error, tasksRes.error, movementsRes.error, materialsRes.error].find((error) => error && isMissingProductionSchema(error));
  if (firstSchemaError) {
    return {
      schemaReady: false,
      message: "Ejecuta la migracion de Inventario y Produccion en Supabase para activar este modulo.",
      items: [],
      tasks: [],
      movements: [],
      task_materials: [],
      cost_centers: centersRes.error ? [] : normalizeCostCenters(centersRes.data ?? []),
      suppliers: suppliersRes.error ? [] : ((suppliersRes.data ?? []) as Supplier[]),
      employees: [],
    };
  }

  if (itemsRes.error) throwSupabaseError("cargar inventario", itemsRes.error);
  if (tasksRes.error) throwSupabaseError("cargar tareas de produccion", tasksRes.error);
  if (movementsRes.error) throwSupabaseError("cargar movimientos de inventario", movementsRes.error);
  if (materialsRes.error) throwSupabaseError("cargar consumos de tareas", materialsRes.error);

  return {
    schemaReady: true,
    items: normalizeInventoryItems(itemsRes.data ?? []),
    tasks: normalizeProductionTasks(tasksRes.data ?? []),
    movements: normalizeInventoryMovements(movementsRes.data ?? []),
    task_materials: normalizeTaskMaterials(materialsRes.data ?? []),
    cost_centers: centersRes.error ? [] : normalizeCostCenters(centersRes.data ?? []),
    suppliers: suppliersRes.error ? [] : ((suppliersRes.data ?? []) as Supplier[]),
    employees: employeesRes.error ? [] : normalizeProductionEmployees(employeesRes.data ?? []),
  };
}

export async function createInventoryItem(input: InventoryItemInput): Promise<string> {
  const supabase = await createClient();
  const name = clean(input.name);
  if (!name) throw new Error("Escribe el nombre del item de inventario.");

  const code = clean(input.code) || await nextInventoryCode(supabase);
  const initialStock = positiveNumber(input.stock);
  const averageCost = positiveNumber(input.average_cost);

  const { data, error } = await supabase
    .from("inventory_items")
    .insert({
      code,
      name,
      category: clean(input.category) || "General",
      unit: clean(input.unit) || "und",
      stock: initialStock,
      average_cost: averageCost,
      min_stock: positiveNumber(input.min_stock),
      location: cleanNullable(input.location),
      preferred_supplier_id: cleanNullable(input.preferred_supplier_id),
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingProductionSchema(error)) throw new Error("Ejecuta la migracion de Inventario y Produccion en Supabase.");
    throwSupabaseError("crear item de inventario", error);
  }

  if (initialStock > 0) {
    await supabase.from("inventory_movements").insert({
      item_id: data.id,
      movement_type: "entrada",
      quantity: initialStock,
      unit_cost: averageCost,
      total_cost: roundMoney(initialStock * averageCost),
      source_type: "inventario_inicial",
      notes: "Stock inicial",
      movement_date: todayInputValue(),
      created_by: await currentUserEmail(supabase),
    });
  }

  revalidatePath("/");
  return String(data.id);
}

export async function createInventoryMovement(input: InventoryMovementInput): Promise<string> {
  const supabase = await createClient();
  return createInventoryMovementInternal(supabase, input, true);
}

export async function createProductionTask(input: ProductionTaskInput): Promise<string> {
  const supabase = await createClient();
  const title = clean(input.title);
  if (!title) throw new Error("Escribe el nombre de la tarea.");

  const userEmail = await currentUserEmail(supabase);
  const { data, error } = await supabase
    .from("production_tasks")
    .insert({
      title,
      process_type: clean(input.process_type) || "General",
      cost_center_code: cleanNullable(input.cost_center_code),
      assigned_to: cleanNullable(input.assigned_to),
      priority: input.priority ?? "media",
      planned_quantity: Math.max(1, positiveNumber(input.planned_quantity) || 1),
      estimated_minutes: Math.max(0, Math.round(positiveNumber(input.estimated_minutes))),
      notes: cleanNullable(input.notes),
      created_by: userEmail,
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingProductionSchema(error)) throw new Error("Ejecuta la migracion de Inventario y Produccion en Supabase.");
    throwSupabaseError("crear tarea de produccion", error);
  }

  await insertTaskEvent(supabase, data.id, "creada", null, userEmail);
  revalidatePath("/");
  return String(data.id);
}

export async function updateProductionTaskStatus(id: string, status: ProductionTaskStatus, notes?: string | null): Promise<void> {
  const supabase = await createClient();
  const cleanId = clean(id);
  if (!cleanId) throw new Error("No se encontro la tarea.");

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (status === "en_proceso") patch.started_at = now;
  if (status === "pausada") patch.paused_at = now;
  if (status === "terminada") patch.finished_at = now;
  if (status === "revisada") patch.reviewed_at = now;

  const { error } = await supabase.from("production_tasks").update(patch).eq("id", cleanId);
  if (error) {
    if (isMissingProductionSchema(error)) throw new Error("Ejecuta la migracion de Inventario y Produccion en Supabase.");
    throwSupabaseError("actualizar tarea de produccion", error);
  }

  await insertTaskEvent(supabase, cleanId, status, cleanNullable(notes), await currentUserEmail(supabase));
  revalidatePath("/");
}

export async function consumeProductionMaterial(input: ProductionMaterialConsumptionInput): Promise<string> {
  const supabase = await createClient();
  const taskId = clean(input.task_id);
  const itemId = clean(input.item_id);
  const quantity = positiveNumber(input.quantity);
  if (!taskId) throw new Error("Selecciona la tarea.");
  if (!itemId) throw new Error("Selecciona el item de inventario.");
  if (quantity <= 0) throw new Error("La cantidad consumida debe ser mayor a cero.");

  const { data: task, error: taskError } = await supabase
    .from("production_tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (taskError || !task) throwSupabaseError("cargar tarea para consumo", taskError ?? {});

  const movementId = await createInventoryMovementInternal(
    supabase,
    {
      item_id: itemId,
      movement_type: "salida",
      quantity,
      cost_center_code: String(task.cost_center_code ?? "") || null,
      production_task_id: taskId,
      source_type: "produccion",
      source_id: taskId,
      notes: cleanNullable(input.notes) || `Consumo tarea #${task.task_number ?? ""}`,
      movement_date: todayInputValue(),
    },
    false,
  );

  const { data: item, error: itemError } = await supabase
    .from("inventory_items")
    .select("average_cost")
    .eq("id", itemId)
    .single();
  if (itemError) throwSupabaseError("leer costo del item consumido", itemError);

  const { data: existing, error: existingError } = await supabase
    .from("production_task_materials")
    .select("*")
    .eq("task_id", taskId)
    .eq("item_id", itemId)
    .maybeSingle();
  if (existingError) throwSupabaseError("consultar material de la tarea", existingError);

  if (existing) {
    const { error } = await supabase
      .from("production_task_materials")
      .update({
        consumed_quantity: roundQuantity(Number(existing.consumed_quantity || 0) + quantity),
        unit_cost_snapshot: Number(item.average_cost || 0),
        notes: cleanNullable(input.notes) ?? existing.notes,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) throwSupabaseError("actualizar consumo de material", error);
  } else {
    const { error } = await supabase.from("production_task_materials").insert({
      task_id: taskId,
      item_id: itemId,
      planned_quantity: 0,
      consumed_quantity: quantity,
      unit_cost_snapshot: Number(item.average_cost || 0),
      notes: cleanNullable(input.notes),
    });
    if (error) throwSupabaseError("guardar consumo de material", error);
  }

  await insertTaskEvent(supabase, taskId, "consumo_material", cleanNullable(input.notes), await currentUserEmail(supabase));
  revalidatePath("/");
  return movementId;
}

async function createInventoryMovementInternal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: InventoryMovementInput,
  shouldRevalidate: boolean,
): Promise<string> {
  const itemId = clean(input.item_id);
  const movementType = input.movement_type;
  if (!itemId) throw new Error("Selecciona el item de inventario.");
  if (!["entrada", "salida", "ajuste"].includes(movementType)) throw new Error("Selecciona un tipo de movimiento valido.");

  const { data: item, error: itemError } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("id", itemId)
    .single();
  if (itemError || !item) {
    if (itemError && isMissingProductionSchema(itemError)) throw new Error("Ejecuta la migracion de Inventario y Produccion en Supabase.");
    throwSupabaseError("cargar item de inventario", itemError ?? {});
  }

  const rawQuantity = Number(input.quantity || 0);
  const quantity = movementType === "ajuste" ? rawQuantity : Math.abs(rawQuantity);
  if (!Number.isFinite(quantity) || quantity === 0) throw new Error("La cantidad del movimiento no puede ser cero.");

  const currentStock = Number(item.stock || 0);
  const currentAverage = Number(item.average_cost || 0);
  const unitCost = positiveNumber(input.unit_cost) || currentAverage;
  const stockDelta = movementType === "entrada" ? quantity : movementType === "salida" ? -quantity : quantity;
  const nextStock = roundQuantity(currentStock + stockDelta);
  if (nextStock < 0) throw new Error(`No hay stock suficiente. Disponible: ${currentStock} ${item.unit || "und"}.`);

  const nextAverage = movementType === "entrada" && quantity > 0
    ? roundMoney(((currentStock * currentAverage) + (quantity * unitCost)) / Math.max(nextStock, quantity))
    : currentAverage;

  const { error: updateError } = await supabase
    .from("inventory_items")
    .update({
      stock: nextStock,
      average_cost: nextAverage,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  if (updateError) throwSupabaseError("actualizar stock", updateError);

  const { data, error } = await supabase
    .from("inventory_movements")
    .insert({
      item_id: itemId,
      movement_type: movementType,
      quantity,
      unit_cost: unitCost,
      total_cost: roundMoney(Math.abs(quantity) * unitCost),
      cost_center_code: cleanNullable(input.cost_center_code),
      production_task_id: cleanNullable(input.production_task_id),
      source_type: cleanNullable(input.source_type) || "manual",
      source_id: cleanNullable(input.source_id),
      notes: cleanNullable(input.notes),
      movement_date: clean(input.movement_date) || todayInputValue(),
      created_by: await currentUserEmail(supabase),
    })
    .select("id")
    .single();
  if (error) throwSupabaseError("registrar movimiento de inventario", error);

  if (shouldRevalidate) revalidatePath("/");
  return String(data.id);
}

async function insertTaskEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  taskId: string,
  eventType: string,
  notes: string | null,
  userEmail: string | null,
): Promise<void> {
  const { error } = await supabase.from("production_task_events").insert({
    task_id: taskId,
    event_type: eventType,
    notes,
    created_by: userEmail,
  });
  if (error && !isMissingProductionSchema(error)) throwSupabaseError("guardar evento de produccion", error);
}

async function nextInventoryCode(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { count, error } = await supabase
    .from("inventory_items")
    .select("id", { count: "exact", head: true });
  if (error && !isMissingProductionSchema(error)) throwSupabaseError("obtener consecutivo de inventario", error);
  return `INV-${String((count ?? 0) + 1).padStart(4, "0")}`;
}

async function currentUserEmail(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.email ?? null;
}

function normalizeInventoryItems(rows: unknown[]): InventoryItem[] {
  return rows.map((row) => {
    const value = row as InventoryItem;
    return {
      ...value,
      stock: Number(value.stock || 0),
      average_cost: Number(value.average_cost || 0),
      min_stock: Number(value.min_stock || 0),
    };
  });
}

function normalizeProductionTasks(rows: unknown[]): ProductionTask[] {
  return rows.map((row) => {
    const value = row as ProductionTask;
    return {
      ...value,
      task_number: Number(value.task_number || 0),
      planned_quantity: Number(value.planned_quantity || 0),
      completed_quantity: Number(value.completed_quantity || 0),
      estimated_minutes: Number(value.estimated_minutes || 0),
    };
  });
}

function normalizeInventoryMovements(rows: unknown[]): InventoryMovement[] {
  return rows.map((row) => {
    const value = row as InventoryMovement;
    return {
      ...value,
      quantity: Number(value.quantity || 0),
      unit_cost: Number(value.unit_cost || 0),
      total_cost: Number(value.total_cost || 0),
      item: value.item ? normalizeInventoryItems([value.item])[0] : null,
      task: value.task ? normalizeProductionTasks([value.task])[0] : null,
    };
  });
}

function normalizeTaskMaterials(rows: unknown[]): ProductionTaskMaterial[] {
  return rows.map((row) => {
    const value = row as ProductionTaskMaterial;
    return {
      ...value,
      planned_quantity: Number(value.planned_quantity || 0),
      consumed_quantity: Number(value.consumed_quantity || 0),
      unit_cost_snapshot: Number(value.unit_cost_snapshot || 0),
      item: value.item ? normalizeInventoryItems([value.item])[0] : null,
      task: value.task ? normalizeProductionTasks([value.task])[0] : null,
    };
  });
}

const validProductionRoles: ProductionEmployeeRole[] = ["operario", "ingeniero", "supervisor", "logistica", "administrativo"];
const assignableProductionRoles = new Set<ProductionEmployeeRole>(["operario", "ingeniero"]);

function normalizeProductionEmployees(rows: unknown[]): ProductionEmployeeOption[] {
  return rows
    .map((row) => {
      const value = row as Record<string, unknown>;
      return {
        id: String(value.id ?? ""),
        name: String(value.name ?? "").trim(),
        roles: normalizeProductionRoles(value.production_roles).filter((role) => assignableProductionRoles.has(role)),
      };
    })
    .filter((employee) => employee.id && employee.name && employee.roles.length);
}

function normalizeProductionRoles(value: unknown): ProductionEmployeeRole[] {
  const rows = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return Array.from(new Set(rows
    .map((item) => String(item ?? "").trim().toLowerCase())
    .filter((item): item is ProductionEmployeeRole => validProductionRoles.includes(item as ProductionEmployeeRole))));
}

function normalizeCostCenters(rows: unknown[]): CostCenterOption[] {
  return rows
    .map((row) => row as CostCenterOption)
    .filter((row) => String(row.code ?? "").trim())
    .map((row) => ({
      code: String(row.code).trim(),
      name: row.name ?? null,
      client_name: row.client_name ?? null,
      type: row.type,
    }));
}

function clean(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function cleanNullable(value: string | null | undefined): string | null {
  const trimmed = clean(value);
  return trimmed ? trimmed : null;
}

function positiveNumber(value: unknown): number {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, number);
}

function roundMoney(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

function roundQuantity(value: number): number {
  return Math.round(Number(value || 0) * 1000) / 1000;
}

function todayInputValue(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function isMissingProductionSchema(error: SupabaseError): boolean {
  const message = `${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return (
    error.code === "42P01" ||
    error.code === "42703" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    message.includes("inventory_items") ||
    message.includes("inventory_movements") ||
    message.includes("production_tasks") ||
    message.includes("production_task_materials") ||
    message.includes("production_task_events")
  );
}

function throwSupabaseError(context: string, error: SupabaseError): never {
  const parts = [`No se pudo ${context}.`];
  if (error.message) parts.push(error.message);
  if (error.code) parts.push(`Codigo: ${error.code}.`);
  if (error.details) parts.push(`Detalle: ${error.details}.`);
  if (error.hint) parts.push(`Sugerencia: ${error.hint}`);
  throw new Error(parts.join(" "));
}
