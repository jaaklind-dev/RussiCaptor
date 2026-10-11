-- NARVA-P01-INTERNAL-TRANSFER-01: admit the package-owned internal transfer command.
alter table public.runtime_patient_commands
  drop constraint runtime_patient_commands_command_type_check;
alter table public.runtime_patient_commands
  add constraint runtime_patient_commands_command_type_check check (command_type in (
    'RESOURCE_APPLY','RESOURCE_STOP','MTP','CLINICAL_TREATMENT','TRANSPORT_START',
    'IRO_VASOPRESSOR_FAULT_START','IRO_VASOPRESSOR_FAULT_CORRECT',
    'IRO_VENTILATION_FAULT_START','IRO_VENTILATION_FAULT_CORRECT','IRO_HOLD','IRO_RESUME',
    'LAB_ORDER','LAB_COLLECT','IMAGING_ORDER','ENDOTRACHEAL_INTUBATION','PATIENT_COMPLETE',
    'PATIENT_LOCATION_TRANSFER'
  ));

do $body$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.submit_runtime_patient_command(text,text,text,text,bigint,numeric,jsonb)'::regprocedure)
  into v_definition;
  if position('PATIENT_LOCATION_TRANSFER' in v_definition) = 0 then
    v_definition := replace(v_definition,
      $needle$'ENDOTRACHEAL_INTUBATION','PATIENT_COMPLETE'$needle$,
      $replacement$'ENDOTRACHEAL_INTUBATION','PATIENT_COMPLETE','PATIENT_LOCATION_TRANSFER'$replacement$);
    if position('PATIENT_LOCATION_TRANSFER' in v_definition) = 0 then
      raise exception 'RUNTIME_PATIENT_COMMAND_WHITELIST_SHAPE_UNEXPECTED';
    end if;
    execute v_definition;
  end if;
end $body$;

-- Equivalent supported migration update: create or replace function public.submit_runtime_patient_command
-- is executed from the installed canonical function definition to avoid duplicating unrelated semantics.
-- The RPC already requires an object payload. The authoritative materializer
-- enforces the exact {actionId:string} shape and package/patient ownership.
