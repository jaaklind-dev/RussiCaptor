import { DemoDataProvider } from "./DemoDataProvider";
import { OneDriveProvider } from "./OneDriveProvider";
import { DemoClinicalDataProvider } from "./DemoClinicalDataProvider";

const USE_DEMO_DATA = true;

export const dataProvider = USE_DEMO_DATA
  ? new DemoDataProvider()
  : new OneDriveProvider();

export const clinicalDataProvider = new DemoClinicalDataProvider();
