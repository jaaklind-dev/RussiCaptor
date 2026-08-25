import { DEFAULT_PHYSIOLOGIC_DECOMPENSATION_CONFIG, resolvePhysiologicDecompensation } from "../PhysiologicDecompensationEngine";
import { defaultVitalSignConfiguration, VitalSignEngine } from "../vitals/VitalSignEngine";

const monitor = (sbp: number, dbp: number, hr: number, spo2: number) => new VitalSignEngine().resolve({ timestamp: 0,
  configuration: defaultVitalSignConfiguration, contributors: [
    { contributorId:"sbp",sourceType:"PATIENT_PROCESS",sourceId:"TEST",layer:"PROCESS",vital:"systolicBp",operation:"TARGET",value:sbp },
    { contributorId:"dbp",sourceType:"PATIENT_PROCESS",sourceId:"TEST",layer:"PROCESS",vital:"diastolicBp",operation:"TARGET",value:dbp },
    { contributorId:"hr",sourceType:"PATIENT_PROCESS",sourceId:"TEST",layer:"PROCESS",vital:"heartRate",operation:"TARGET",value:hr },
    { contributorId:"spo2",sourceType:"PATIENT_PROCESS",sourceId:"TEST",layer:"PROCESS",vital:"spo2",operation:"TARGET",value:spo2 },
  ] }).state;

const resolve = (vitals: ReturnType<typeof monitor>, time = 0, previous?: Parameters<typeof resolvePhysiologicDecompensation>[0]["previous"]) =>
  resolvePhysiologicDecompensation({ monitor:vitals, previous, config:DEFAULT_PHYSIOLOGIC_DECOMPENSATION_CONFIG,
    simulationTimeSec:time, previousStatus:"Stable" });

describe("WP-48 generic physiologic decompensation", () => {
  test("separates true oxygenation from deterministic pulse-ox signal quality and recovers", () => {
    expect(resolve(monitor(120,75,80,98)).monitor.pulseOx).toMatchObject({signalQuality:"GOOD",measuredSpO2:98,physiologicOxygenation:98});
    const poor = resolve(monitor(65,35,120,88)); expect(poor.monitor.pulseOx?.signalQuality).toBe("POOR");
    const lost = resolve(monitor(35,20,150,62));
    expect(lost.monitor.pulseOx).toMatchObject({signalQuality:"NO_SIGNAL",physiologicOxygenation:62});
    expect(lost.monitor.pulseOx).not.toHaveProperty("measuredSpO2");
    expect(resolve(monitor(110,70,90,94),10,lost.state).monitor.pulseOx?.signalQuality).toBe("GOOD");
  });

  test("shock and hypoxia compose into reversible GCS deterioration", () => {
    const shock = resolve(monitor(50,25,135,96));
    const hypoxia = resolve(monitor(115,70,85,65));
    const combined = resolve(monitor(40,20,150,55));
    expect(shock.monitor.readings.gcs.current).toBeLessThan(15);
    expect(hypoxia.monitor.readings.gcs.current).toBeLessThan(15);
    expect(combined.monitor.readings.gcs.current).toBeLessThanOrEqual(Math.min(shock.monitor.readings.gcs.current,hypoxia.monitor.readings.gcs.current));
    expect(resolve(monitor(120,75,80,98),60,combined.state).monitor.readings.gcs.current).toBe(15);
  });

  test("recovery is not blocked by the previous monitor's low GCS", () => {
    const impaired = resolve(monitor(40,20,150,55));
    const recoveredMonitor = monitor(120,75,80,98);
    recoveredMonitor.readings.gcs.current = impaired.monitor.readings.gcs.current;
    recoveredMonitor.readings.gcs.target = impaired.monitor.readings.gcs.target;
    expect(resolve(recoveredMonitor,60,impaired.state).monitor.readings.gcs).toMatchObject({current:15,target:15});
  });

  test("requires sustained profound failure, supports rescue, and makes DEAD sticky", () => {
    const severe = monitor(30,15,160,55);
    const start = resolve(severe,0); expect(start.state.clinicalState).not.toBe("DEAD");
    const terminal = resolve(severe,300,start.state); expect(terminal.state.clinicalState).toBe("TERMINAL");
    expect(resolve(monitor(120,75,80,98),301,terminal.state).state.clinicalState).toBe("ALIVE");
    const dead = resolve(severe,600,start.state); expect(dead.state.clinicalState).toBe("DEAD");
    expect(dead.monitor.readings).toMatchObject({heartRate:{current:0},systolicBp:{current:0},diastolicBp:{current:0},respiratoryRate:{current:0},gcs:{current:3}});
    expect(dead.monitor).toMatchObject({quality:"LOST",derived:{meanArterialPressure:0},pulseOx:{signalQuality:"NO_SIGNAL"}});
    expect(dead.monitor.pulseOx).not.toHaveProperty("measuredSpO2");
    expect(resolve(monitor(120,75,80,98),900,dead.state)).toMatchObject({state:{clinicalState:"DEAD"},status:"Dead"});
  });

  test("is deterministic", () => expect(resolve(severeFixture(),600,resolve(severeFixture(),0).state)).toEqual(resolve(severeFixture(),600,resolve(severeFixture(),0).state)));
});

const severeFixture = () => monitor(30,15,160,55);
