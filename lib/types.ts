export type Supplier = {
  id: string;
  third_party_id?: string | null;
  name: string;
  nit: string | null;
  address: string | null;
  maps_link: string | null;
  phone: string | null;
  email: string | null;
  default_iva_rate: number;
  default_rte_fte_rate: number;
  created_at: string;
};

export type CostCenterType = "project" | "spare_order" | "administrative" | "maintenance" | "other";

export type CostCenterOption = {
  code: string;
  name: string | null;
  client_name: string | null;
  type: CostCenterType;
};

export type InventoryMovementType = "entrada" | "salida" | "ajuste";
export type ProductionTaskPriority = "baja" | "media" | "alta" | "urgente";
export type ProductionEmployeeRole = "operario" | "ingeniero" | "supervisor" | "logistica" | "administrativo";
export type ProductionTaskStatus = "pendiente" | "en_proceso" | "pausada" | "bloqueada" | "terminada" | "revisada" | "cancelada";

export type InventoryItem = {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  stock: number;
  average_cost: number;
  min_stock: number;
  location: string | null;
  preferred_supplier_id: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
  preferred_supplier?: Supplier | null;
};

export type ProductionTask = {
  id: string;
  task_number: number;
  title: string;
  process_type: string;
  cost_center_code: string | null;
  assigned_to: string | null;
  priority: ProductionTaskPriority;
  status: ProductionTaskStatus;
  planned_quantity: number;
  completed_quantity: number;
  estimated_minutes: number;
  started_at: string | null;
  paused_at: string | null;
  finished_at: string | null;
  reviewed_at: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductionTaskMaterial = {
  id: string;
  task_id: string;
  item_id: string;
  planned_quantity: number;
  consumed_quantity: number;
  unit_cost_snapshot: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  item?: InventoryItem | null;
  task?: ProductionTask | null;
};

export type InventoryMovement = {
  id: string;
  item_id: string;
  movement_type: InventoryMovementType;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  cost_center_code: string | null;
  production_task_id: string | null;
  source_type: string | null;
  source_id: string | null;
  notes: string | null;
  movement_date: string;
  created_by: string | null;
  created_at: string;
  item?: InventoryItem | null;
  task?: ProductionTask | null;
};

export type ProductionEmployeeOption = { id: string; name: string; roles: ProductionEmployeeRole[] };

export type ProductionWorkspaceData = {
  schemaReady: boolean;
  message?: string;
  items: InventoryItem[];
  tasks: ProductionTask[];
  movements: InventoryMovement[];
  task_materials: ProductionTaskMaterial[];
  cost_centers: CostCenterOption[];
  suppliers: Supplier[];
  employees: ProductionEmployeeOption[];
};

export type InventoryItemInput = {
  code?: string;
  name: string;
  category?: string;
  unit?: string;
  stock?: number;
  average_cost?: number;
  min_stock?: number;
  location?: string;
  preferred_supplier_id?: string | null;
};

export type InventoryMovementInput = {
  item_id: string;
  movement_type: InventoryMovementType;
  quantity: number;
  unit_cost?: number;
  cost_center_code?: string | null;
  production_task_id?: string | null;
  source_type?: string | null;
  source_id?: string | null;
  notes?: string | null;
  movement_date?: string | null;
};

export type ProductionTaskInput = {
  title: string;
  process_type: string;
  cost_center_code?: string | null;
  assigned_to?: string | null;
  priority?: ProductionTaskPriority;
  planned_quantity?: number;
  estimated_minutes?: number;
  notes?: string | null;
};

export type ProductionMaterialConsumptionInput = {
  task_id: string;
  item_id: string;
  quantity: number;
  notes?: string | null;
};
