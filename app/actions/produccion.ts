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
  ProductionMaterialBatchConsumptionInput,
  ProductionEmployeeOption,
  ProductionEmployeeRole,
  ProductionTask,
  ProductionTaskAttachment,
  ProductionTaskInput,
  ProductionTaskMaterial,
  ProductionTaskStatus,
  ProductionSubtask,
  ProductionSubtaskAssignment,
  ProductionWorkSession,
  ProductionWorkspaceData,
  Supplier,
} from "@/lib/types";

type SupabaseError = { message?: string; code?: string; hint?: string | null; details?: string | null };
const productionAttachmentsBucket = "production-task-attachments";

export async function listProductionWorkspaceData(): Promise<ProductionWorkspaceData> {
  const supabase = await createClient();

  const [itemsRes, tasksRes, subtasksRes, assignmentsRes, attachmentsRes, workSessionsRes, movementsRes, materialsRes, centersRes, suppliersRes, employeesRes] = await Promise.all([
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
      .from("production_subtasks")
      .select("*")
      .order("position")
      .limit(600),
    supabase
      .from("production_subtask_assignments")
      .select("*")
      .limit(1500),
    supabase
      .from("production_task_attachments")
      .select("*")
      .order("created_at")
      .limit(1000),
    supabase
      .from("production_work_sessions")
      .select("*")
      .order("started_at", { ascending: false })
      .limit(3000),
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

  const firstSchemaError = [itemsRes.error, tasksRes.error, movementsRes.error, materialsRes.error]
    .find((error) => error && isMissingProductionSchema(error));
  if (firstSchemaError) {
    return {
      schemaReady: false,
      taskExtensionsReady: false,
      timeTrackingReady: false,
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
  const extensionErrors = [subtasksRes.error, assignmentsRes.error, attachmentsRes.error].filter(Boolean) as SupabaseError[];
  const taskExtensionsReady = extensionErrors.length === 0;
  const unexpectedExtensionError = extensionErrors.find((error) => !isMissingProductionSchema(error));
  if (unexpectedExtensionError) throwSupabaseError("cargar subtareas y adjuntos", unexpectedExtensionError);
  const timeTrackingReady = !workSessionsRes.error;
  if (workSessionsRes.error && !isMissingProductionSchema(workSessionsRes.error)) {
    throwSupabaseError("cargar el historial de tiempos", workSessionsRes.error);
  }

  const attachments = normalizeTaskAttachments(taskExtensionsReady ? attachmentsRes.data ?? [] : []);
  const attachmentPaths = attachments.map((attachment) => attachment.bucket_path);
  if (attachmentPaths.length) {
    const { data: signedFiles } = await supabase.storage
      .from(productionAttachmentsBucket)
      .createSignedUrls(attachmentPaths, 60 * 60);
    const urlsByPath = new Map((signedFiles ?? []).map((file) => [file.path, file.signedUrl]));
    attachments.forEach((attachment) => {
      attachment.url = urlsByPath.get(attachment.bucket_path) ?? null;
    });
  }

  const assignments = normalizeSubtaskAssignments(taskExtensionsReady ? assignmentsRes.data ?? [] : []);
  const workSessions = normalizeWorkSessions(timeTrackingReady ? workSessionsRes.data ?? [] : []);
  const subtasks = normalizeProductionSubtasks(taskExtensionsReady ? subtasksRes.data ?? [] : [], assignments, attachments, workSessions);

  return {
    schemaReady: true,
    taskExtensionsReady,
    timeTrackingReady,
    items: normalizeInventoryItems(itemsRes.data ?? []),
    tasks: normalizeProductionTasks(tasksRes.data ?? [], subtasks, attachments, workSessions),
    movements: normalizeInventoryMovements(movementsRes.data ?? []),
    task_materials: normalizeTaskMaterials(materialsRes.data ?? []),
    cost_centers: centersRes.error ? [] : normalizeCostCenters(centersRes.data ?? []),
    suppliers: suppliersRes.error ? [] : ((suppliersRes.data ?? []) as Supplier[]),
    employees: employeesRes.error ? [] : normalizeProductionEmployees(employeesRes.data ?? []),
  };
}

export async function createInventoryItem(input: InventoryItemInput): Promise<string> {
  const supabase = await createClient();
  const performedBy = await currentAuthenticatedActor(supabase);
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
      created_by: performedBy,
    });
  }

  revalidatePath("/");
  return String(data.id);
}

export async function updateInventoryItem(id: string, input: InventoryItemInput): Promise<void> {
  const supabase = await createClient();
  const performedBy = await currentAuthenticatedActor(supabase);
  const itemId = clean(id);
  const name = clean(input.name);
  if (!itemId) throw new Error("No se encontro el item de inventario.");
  if (!name) throw new Error("Escribe el nombre del item de inventario.");

  const { data: currentItem, error: currentError } = await supabase
    .from("inventory_items")
    .select("*")
    .eq("id", itemId)
    .single();
  if (currentError || !currentItem) throwSupabaseError("cargar el item de inventario", currentError ?? {});

  const currentStock = Number(currentItem.stock || 0);
  const nextStock = roundQuantity(positiveNumber(input.stock));
  const stockDifference = roundQuantity(nextStock - currentStock);
  const now = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("inventory_items")
    .update({
      name,
      category: clean(input.category) || "General",
      unit: clean(input.unit) || "und",
      stock: nextStock,
      min_stock: positiveNumber(input.min_stock),
      location: cleanNullable(input.location),
      preferred_supplier_id: cleanNullable(input.preferred_supplier_id),
      updated_at: now,
    })
    .eq("id", itemId);
  if (updateError) throwSupabaseError("actualizar el item de inventario", updateError);

  if (stockDifference !== 0) {
    const unitCost = Number(currentItem.average_cost || 0);
    const { error: movementError } = await supabase.from("inventory_movements").insert({
      item_id: itemId,
      movement_type: "ajuste",
      quantity: stockDifference,
      unit_cost: unitCost,
      total_cost: roundMoney(Math.abs(stockDifference) * unitCost),
      source_type: "edicion_inventario",
      source_id: itemId,
      notes: `Stock corregido de ${currentStock} a ${nextStock}`,
      movement_date: todayInputValue(),
      created_by: performedBy,
    });
    if (movementError) throwSupabaseError("guardar el ajuste de stock", movementError);
  }

  revalidatePath("/");
}

export async function archiveInventoryItem(id: string): Promise<void> {
  const supabase = await createClient();
  await currentAuthenticatedActor(supabase);
  const itemId = clean(id);
  if (!itemId) throw new Error("No se encontro el item de inventario.");

  const { error } = await supabase
    .from("inventory_items")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) throwSupabaseError("eliminar el item de inventario", error);
  revalidatePath("/");
}

export async function createInventoryMovement(input: InventoryMovementInput): Promise<string> {
  const supabase = await createClient();
  const performedBy = await currentAuthenticatedActor(supabase);
  return createInventoryMovementInternal(supabase, input, true, performedBy);
}

export async function createProductionTask(input: ProductionTaskInput): Promise<string> {
  const supabase = await createClient();
  const performedBy = await resolveTaskActor(supabase, input.performed_by, true);
  const title = clean(input.title);
  if (!title) throw new Error("Escribe el nombre de la tarea.");

  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;
  if (!user) throw new Error("Tu sesion vencio. Vuelve a ingresar.");
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
      created_by: performedBy,
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingProductionSchema(error)) throw new Error("Ejecuta la migracion de Inventario y Produccion en Supabase.");
    throwSupabaseError("crear tarea de produccion", error);
  }

  const taskId = String(data.id);
  try {
    const subtaskInputs = (input.subtasks ?? [])
      .slice(0, 30)
      .map((subtask, position) => ({
        input: subtask,
        position,
        title: clean(subtask.title),
      }))
      .filter((subtask) => subtask.title);

    const subtaskIdByPosition = new Map<number, string>();
    if (subtaskInputs.length) {
      const { data: createdSubtasks, error: subtasksError } = await supabase
        .from("production_subtasks")
        .insert(subtaskInputs.map((subtask) => ({
          task_id: taskId,
          position: subtask.position,
          title: subtask.title,
          notes: cleanNullable(subtask.input.notes),
        })))
        .select("id,position");
      if (subtasksError) throwSupabaseError("crear las subtareas", subtasksError);
      (createdSubtasks ?? []).forEach((subtask) => subtaskIdByPosition.set(Number(subtask.position), String(subtask.id)));

      const assignmentRows = subtaskInputs.flatMap((subtask) => {
        const subtaskId = subtaskIdByPosition.get(subtask.position);
        if (!subtaskId) return [];
        const uniqueEmployees = new Map(
          (subtask.input.assigned_to ?? [])
            .map((employee) => [clean(employee.employee_id), clean(employee.employee_name)] as const)
            .filter(([employeeId, employeeName]) => employeeId && employeeName),
        );
        return Array.from(uniqueEmployees, ([employee_id, employee_name]) => ({
          subtask_id: subtaskId,
          employee_id,
          employee_name,
        }));
      });
      if (assignmentRows.length) {
        const { error: assignmentsError } = await supabase
          .from("production_subtask_assignments")
          .insert(assignmentRows);
        if (assignmentsError) throwSupabaseError("asignar operarios a las subtareas", assignmentsError);
      }
    }

    const attachmentRows = [
      ...validAttachmentRows(input.attachments, user.id).map((attachment) => ({
        ...attachment,
        task_id: taskId,
        subtask_id: null,
        uploaded_by: performedBy,
      })),
      ...subtaskInputs.flatMap((subtask) => {
        const subtaskId = subtaskIdByPosition.get(subtask.position);
        if (!subtaskId) return [];
        return validAttachmentRows(subtask.input.attachments, user.id).map((attachment) => ({
          ...attachment,
          task_id: taskId,
          subtask_id: subtaskId,
          uploaded_by: performedBy,
        }));
      }),
    ];
    if (attachmentRows.length) {
      const { error: attachmentsError } = await supabase
        .from("production_task_attachments")
        .insert(attachmentRows);
      if (attachmentsError) throwSupabaseError("guardar los adjuntos de la tarea", attachmentsError);
    }

    await insertTaskEvent(
      supabase,
      taskId,
      "creada",
      subtaskInputs.length ? `${subtaskInputs.length} subtarea${subtaskInputs.length === 1 ? "" : "s"}` : null,
      performedBy,
    );
    revalidatePath("/");
    return taskId;
  } catch (creationError) {
    await supabase.from("production_tasks").delete().eq("id", taskId);
    throw creationError;
  }
}

export async function updateProductionTaskStatus(id: string, status: ProductionTaskStatus, notes?: string | null, performedById?: string): Promise<void> {
  const supabase = await createClient();
  const requiresSharedOperator = ["en_proceso", "pausada", "terminada", "revisada"].includes(status);
  const performedBy = await resolveTaskActor(supabase, performedById, requiresSharedOperator);
  const cleanId = clean(id);
  if (!cleanId) throw new Error("No se encontro la tarea.");

  const { data: currentTask, error: currentTaskError } = await supabase
    .from("production_tasks")
    .select("status,started_at")
    .eq("id", cleanId)
    .single();
  if (currentTaskError || !currentTask) throwSupabaseError("consultar la tarea de produccion", currentTaskError ?? {});

  if (status === "terminada") {
    const { data: subtasks, error: subtasksError } = await supabase
      .from("production_subtasks")
      .select("status")
      .eq("task_id", cleanId);
    if (subtasksError && !isMissingProductionSchema(subtasksError)) throwSupabaseError("validar las subtareas", subtasksError);
    if ((subtasks ?? []).some((subtask) => !["terminada", "revisada"].includes(String(subtask.status)))) {
      throw new Error("Termina primero todas las subtareas.");
    }
  }

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now };
  if (status === "en_proceso" && !currentTask.started_at) patch.started_at = now;
  if (status === "pausada") patch.paused_at = now;
  if (status === "terminada") patch.finished_at = now;
  if (status === "revisada") patch.reviewed_at = now;

  const { error } = await supabase.from("production_tasks").update(patch).eq("id", cleanId);
  if (error) {
    if (isMissingProductionSchema(error)) throw new Error("Ejecuta la migracion de Inventario y Produccion en Supabase.");
    throwSupabaseError("actualizar tarea de produccion", error);
  }

  if (status === "en_proceso") {
    await openWorkSession(supabase, cleanId, null, now, performedBy);
  } else if (["pausada", "terminada", "cancelada"].includes(status)) {
    await closeWorkSessions(supabase, cleanId, null, now, status, performedBy);
    if (status === "cancelada") await closeAllWorkSessionsForTask(supabase, cleanId, now, status, performedBy);
  }

  await insertTaskEvent(supabase, cleanId, status, cleanNullable(notes), performedBy);
  revalidatePath("/");
}

export async function updateProductionSubtaskStatus(id: string, status: ProductionTaskStatus, performedById?: string): Promise<void> {
  const supabase = await createClient();
  const performedBy = await resolveTaskActor(supabase, performedById, true);
  const cleanId = clean(id);
  if (!cleanId) throw new Error("No se encontro la subtarea.");
  if (!["pendiente", "en_proceso", "pausada", "terminada"].includes(status)) {
    throw new Error("Estado de subtarea no valido.");
  }

  const { data: subtask, error: subtaskError } = await supabase
    .from("production_subtasks")
    .select("task_id,title,status")
    .eq("id", cleanId)
    .single();
  if (subtaskError || !subtask) throwSupabaseError("consultar la subtarea", subtaskError ?? {});

  const taskId = String(subtask.task_id);
  const now = new Date().toISOString();
  const { error: updateSubtaskError } = await supabase
    .from("production_subtasks")
    .update({ status, updated_at: now })
    .eq("id", cleanId);
  if (updateSubtaskError) throwSupabaseError("actualizar la subtarea", updateSubtaskError);

  if (status === "en_proceso") {
    await openWorkSession(supabase, taskId, cleanId, now, performedBy);
  } else if (["pausada", "terminada"].includes(status)) {
    await closeWorkSessions(supabase, taskId, cleanId, now, status, performedBy);
  }

  const { data: siblingSubtasks, error: siblingsError } = await supabase
    .from("production_subtasks")
    .select("status")
    .eq("task_id", taskId);
  if (siblingsError) throwSupabaseError("actualizar el avance de la tarea", siblingsError);

  const statuses = (siblingSubtasks ?? []).map((row) => String(row.status));
  const allFinished = statuses.length > 0 && statuses.every((value) => value === "terminada");
  const anyInProgress = statuses.some((value) => value === "en_proceso");
  const anyPaused = statuses.some((value) => value === "pausada");
  const taskStatus: ProductionTaskStatus = allFinished ? "terminada" : anyInProgress ? "en_proceso" : anyPaused ? "pausada" : "pendiente";
  const { data: currentTask, error: currentTaskError } = await supabase
    .from("production_tasks")
    .select("status,started_at")
    .eq("id", taskId)
    .single();
  if (currentTaskError || !currentTask) throwSupabaseError("consultar el avance de la tarea", currentTaskError ?? {});

  const taskPatch: Record<string, unknown> = { status: taskStatus, updated_at: now };
  if (taskStatus === "en_proceso" && !currentTask.started_at) taskPatch.started_at = now;
  if (taskStatus === "pausada") taskPatch.paused_at = now;
  if (taskStatus === "terminada") taskPatch.finished_at = now;

  const { error: taskError } = await supabase.from("production_tasks").update(taskPatch).eq("id", taskId);
  if (taskError) throwSupabaseError("actualizar el avance de la tarea", taskError);

  if (taskStatus === "en_proceso") {
    await openWorkSession(supabase, taskId, null, now, performedBy);
  } else if (String(currentTask.status) === "en_proceso" || taskStatus === "terminada") {
    await closeWorkSessions(supabase, taskId, null, now, taskStatus, performedBy);
  }

  await insertTaskEvent(
    supabase,
    taskId,
    `subtarea_${status}`,
    clean(String(subtask.title)) || null,
    performedBy,
  );
  revalidatePath("/");
}

export async function consumeProductionMaterial(input: ProductionMaterialConsumptionInput): Promise<string> {
  const movementIds = await consumeProductionMaterials({
    task_id: input.task_id,
    items: [{ item_id: input.item_id, quantity: input.quantity }],
    notes: input.notes,
  });
  return movementIds[0];
}

export async function consumeProductionMaterials(input: ProductionMaterialBatchConsumptionInput): Promise<string[]> {
  const supabase = await createClient();
  const performedBy = await currentAuthenticatedActor(supabase);
  const taskId = clean(input.task_id);
  if (!taskId) throw new Error("Selecciona la tarea.");

  const groupedItems = new Map<string, number>();
  for (const row of input.items.slice(0, 50)) {
    const itemId = clean(row.item_id);
    const quantity = positiveNumber(row.quantity);
    if (!itemId || quantity <= 0) continue;
    groupedItems.set(itemId, roundQuantity((groupedItems.get(itemId) ?? 0) + quantity));
  }
  const rows = Array.from(groupedItems, ([item_id, quantity]) => ({ item_id, quantity }));
  if (!rows.length) throw new Error("Agrega al menos un material con una cantidad mayor a cero.");

  const { data: task, error: taskError } = await supabase
    .from("production_tasks")
    .select("*")
    .eq("id", taskId)
    .single();
  if (taskError || !task) throwSupabaseError("cargar tarea para consumo", taskError ?? {});

  const { data: stockItems, error: stockError } = await supabase
    .from("inventory_items")
    .select("*")
    .in("id", rows.map((row) => row.item_id));
  if (stockError) throwSupabaseError("validar materiales de inventario", stockError);

  const inventoryById = new Map((stockItems ?? []).map((item) => [String(item.id), item as InventoryItem]));
  for (const row of rows) {
    const item = inventoryById.get(row.item_id);
    if (!item) throw new Error("Uno de los materiales ya no existe en inventario.");
    if (!item.active) throw new Error(`${item.name} está inactivo y no se puede consumir.`);
    if (row.quantity > Number(item.stock || 0)) {
      throw new Error(`No hay stock suficiente de ${item.name}. Disponible: ${Number(item.stock || 0)} ${item.unit || "und"}.`);
    }
  }

  const notes = cleanNullable(input.notes);
  const movementIds: string[] = [];
  for (const row of rows) {
    const item = inventoryById.get(row.item_id) as InventoryItem;
    movementIds.push(await recordProductionMaterialConsumption(
      supabase,
      task as ProductionTask,
      item,
      row.quantity,
      notes,
      performedBy,
    ));
  }

  await insertTaskEvent(
    supabase,
    taskId,
    "consumo_material",
    notes || `${rows.length} material${rows.length === 1 ? "" : "es"} registrado${rows.length === 1 ? "" : "s"}`,
    performedBy,
  );
  revalidatePath("/");
  return movementIds;
}

async function recordProductionMaterialConsumption(
  supabase: Awaited<ReturnType<typeof createClient>>,
  task: ProductionTask,
  item: InventoryItem,
  quantity: number,
  notes: string | null,
  performedBy: string,
): Promise<string> {
  const taskId = clean(task.id);
  const itemId = clean(item.id);
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
      notes: notes || `Consumo tarea #${task.task_number ?? ""}`,
      movement_date: todayInputValue(),
    },
    false,
    performedBy,
  );

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
        notes: notes ?? existing.notes,
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
      notes,
    });
    if (error) throwSupabaseError("guardar consumo de material", error);
  }

  return movementId;
}

async function createInventoryMovementInternal(
  supabase: Awaited<ReturnType<typeof createClient>>,
  input: InventoryMovementInput,
  shouldRevalidate: boolean,
  performedBy: string,
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
      created_by: performedBy,
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

async function openWorkSession(
  supabase: Awaited<ReturnType<typeof createClient>>,
  taskId: string,
  subtaskId: string | null,
  startedAt: string,
  userEmail: string | null,
): Promise<void> {
  let openQuery = supabase
    .from("production_work_sessions")
    .select("id")
    .eq("task_id", taskId)
    .is("ended_at", null);
  openQuery = subtaskId ? openQuery.eq("subtask_id", subtaskId) : openQuery.is("subtask_id", null);
  const { data: openSession, error: openError } = await openQuery.maybeSingle();
  if (openError) {
    if (isMissingProductionSchema(openError)) return;
    throwSupabaseError("consultar el historial de tiempos", openError);
  }
  if (openSession) return;

  const { error } = await supabase.from("production_work_sessions").insert({
    task_id: taskId,
    subtask_id: subtaskId,
    started_at: startedAt,
    started_by: userEmail,
  });
  if (error && error.code !== "23505" && !isMissingProductionSchema(error)) {
    throwSupabaseError("iniciar el registro de tiempo", error);
  }
}

async function closeWorkSessions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  taskId: string,
  subtaskId: string | null,
  endedAt: string,
  reason: string,
  userEmail: string | null,
): Promise<void> {
  let closeQuery = supabase
    .from("production_work_sessions")
    .update({
      ended_at: endedAt,
      end_reason: reason,
      ended_by: userEmail,
      updated_at: endedAt,
    })
    .eq("task_id", taskId)
    .is("ended_at", null);
  closeQuery = subtaskId ? closeQuery.eq("subtask_id", subtaskId) : closeQuery.is("subtask_id", null);
  const { error } = await closeQuery;
  if (error && !isMissingProductionSchema(error)) throwSupabaseError("cerrar el registro de tiempo", error);
}

async function closeAllWorkSessionsForTask(
  supabase: Awaited<ReturnType<typeof createClient>>,
  taskId: string,
  endedAt: string,
  reason: string,
  userEmail: string | null,
): Promise<void> {
  const { error } = await supabase
    .from("production_work_sessions")
    .update({
      ended_at: endedAt,
      end_reason: reason,
      ended_by: userEmail,
      updated_at: endedAt,
    })
    .eq("task_id", taskId)
    .is("ended_at", null);
  if (error && !isMissingProductionSchema(error)) throwSupabaseError("cerrar el historial de la tarea", error);
}

async function nextInventoryCode(supabase: Awaited<ReturnType<typeof createClient>>): Promise<string> {
  const { count, error } = await supabase
    .from("inventory_items")
    .select("id", { count: "exact", head: true });
  if (error && !isMissingProductionSchema(error)) throwSupabaseError("obtener consecutivo de inventario", error);
  return `INV-${String((count ?? 0) + 1).padStart(4, "0")}`;
}

async function resolveTaskActor(
  supabase: Awaited<ReturnType<typeof createClient>>,
  performerId: string | null | undefined,
  requireSharedOperator: boolean,
): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) throw new Error("Tu sesion vencio. Vuelve a ingresar.");
  if (!isSharedProductionAccount(user.email)) return authenticatedActorLabel(user);
  if (!requireSharedOperator) return "Produccion";
  return resolvePerformerName(supabase, performerId);
}

async function currentAuthenticatedActor(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string> {
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) throw new Error("Tu sesion vencio. Vuelve a ingresar.");
  return authenticatedActorLabel(user);
}

function authenticatedActorLabel(user: { email?: string | null; user_metadata?: Record<string, unknown> }): string {
  const metadata = user.user_metadata ?? {};
  return clean(String(metadata.full_name || metadata.name || user.email || "Usuario"));
}

function isSharedProductionAccount(email: string | null | undefined): boolean {
  return clean(email).toLowerCase() === "produccion@tecondor.com";
}

async function resolvePerformerName(
  supabase: Awaited<ReturnType<typeof createClient>>,
  performerId: string | null | undefined,
): Promise<string> {
  const cleanId = clean(performerId);
  if (!cleanId) throw new Error("Selecciona quien esta usando la aplicacion.");

  const { data, error } = await supabase
    .from("payroll_employees")
    .select("id,name,production_roles")
    .eq("id", cleanId)
    .eq("deleted", false)
    .single();
  if (error || !data) throw new Error("La persona seleccionada ya no esta disponible. Elige nuevamente quien usa la aplicacion.");

  const roles = normalizeProductionRoles(data.production_roles);
  if (!roles.some((role) => assignableProductionRoles.has(role))) {
    throw new Error("Solo operarios e ingenieros pueden registrar acciones de produccion.");
  }

  const name = clean(data.name);
  if (!name) throw new Error("La persona seleccionada no tiene un nombre valido.");
  return name;
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

function normalizeProductionTasks(
  rows: unknown[],
  subtasks: ProductionSubtask[] = [],
  attachments: ProductionTaskAttachment[] = [],
  workSessions: ProductionWorkSession[] = [],
): ProductionTask[] {
  return rows.map((row) => {
    const value = row as ProductionTask;
    return {
      ...value,
      task_number: Number(value.task_number || 0),
      planned_quantity: Number(value.planned_quantity || 0),
      completed_quantity: Number(value.completed_quantity || 0),
      estimated_minutes: Number(value.estimated_minutes || 0),
      subtasks: subtasks.filter((subtask) => subtask.task_id === value.id),
      attachments: attachments.filter((attachment) => attachment.task_id === value.id && !attachment.subtask_id),
      work_sessions: workSessions.filter((session) => session.task_id === value.id && !session.subtask_id),
    };
  });
}

function normalizeTaskAttachments(rows: unknown[]): ProductionTaskAttachment[] {
  return rows.map((row) => {
    const value = row as ProductionTaskAttachment;
    return {
      ...value,
      size_bytes: Number(value.size_bytes || 0),
      url: null,
    };
  });
}

function normalizeSubtaskAssignments(rows: unknown[]): ProductionSubtaskAssignment[] {
  return rows.map((row) => row as ProductionSubtaskAssignment);
}

function normalizeWorkSessions(rows: unknown[]): ProductionWorkSession[] {
  return rows.map((row) => row as ProductionWorkSession);
}

function normalizeProductionSubtasks(
  rows: unknown[],
  assignments: ProductionSubtaskAssignment[],
  attachments: ProductionTaskAttachment[],
  workSessions: ProductionWorkSession[],
): ProductionSubtask[] {
  return rows.map((row) => {
    const value = row as ProductionSubtask;
    return {
      ...value,
      position: Number(value.position || 0),
      assignments: assignments.filter((assignment) => assignment.subtask_id === value.id),
      attachments: attachments.filter((attachment) => attachment.subtask_id === value.id),
      work_sessions: workSessions.filter((session) => session.subtask_id === value.id),
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

function validAttachmentRows(
  attachments: ProductionTaskInput["attachments"],
  userId: string,
): Array<{
  bucket_path: string;
  file_name: string;
  content_type: string | null;
  size_bytes: number;
}> {
  return (attachments ?? [])
    .slice(0, 20)
    .map((attachment) => ({
      bucket_path: clean(attachment.bucket_path),
      file_name: clean(attachment.file_name),
      content_type: cleanNullable(attachment.content_type),
      size_bytes: Math.max(0, Math.round(positiveNumber(attachment.size_bytes))),
    }))
    .filter((attachment) => (
      attachment.bucket_path.startsWith(`${userId}/`) &&
      attachment.file_name &&
      attachment.size_bytes <= 8 * 1024 * 1024
    ));
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
    message.includes("production_task_events") ||
    message.includes("production_subtasks") ||
    message.includes("production_subtask_assignments") ||
    message.includes("production_task_attachments") ||
    message.includes("production_work_sessions")
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
