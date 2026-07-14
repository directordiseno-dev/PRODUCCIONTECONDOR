export function formatCOP(amount: number): string {
  return "$ " + Math.round(amount).toLocaleString("es-CO");
}

export function formatDateShort(date: string | Date): string {
  const value = typeof date === "string" ? new Date(date + "T12:00:00") : date;
  return value.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatQuantity(value: number): string {
  return value.toLocaleString("es-CO", { maximumFractionDigits: 3 });
}
