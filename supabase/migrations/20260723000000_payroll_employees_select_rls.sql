-- Permitir que cualquier usuario autenticado de la empresa lea la lista de empleados de nómina (necesario para el módulo de producción)
drop policy if exists "payroll_select_employees_authenticated" on public.payroll_employees;
create policy "payroll_select_employees_authenticated" on public.payroll_employees
  for select to authenticated
  using (true);
