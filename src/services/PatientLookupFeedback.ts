const DEFAULT_DATA_SOURCE = "Sisseehitatud demoandmed";

export function getPatientNotFoundMessage(
  searchedValue: string,
  workbookFileName?: string
): string {
  const dataSource = workbookFileName?.trim() || DEFAULT_DATA_SOURCE;

  return [
    `Otsitud kood: ${searchedValue.trim()}`,
    `Aktiivne andmeallikas: ${dataSource}`,
    "",
    "Kui Exceli andmeid muudeti, impordi töövihik EXCON-vaates uuesti.",
  ].join("\n");
}
