import type { MassiveTransfusionPatientProcessRuntime } from "@/models/MassiveTransfusion";

export type MtpCalciumAssessment = Readonly<{
  status: "MET" | "NOT_MET" | "NOT_APPLICABLE";
  completedRbcUnitsTotal: number;
  calciumAdministrations: number;
  explanation: string;
}>;

/** Pure protocol projection. It has no effect on Runtime completion or physiology. */
export function assessMtpCalcium(process: MassiveTransfusionPatientProcessRuntime): MtpCalciumAssessment {
  const state = process.clinicalState;
  if (!process.configuration.calciumReplacement?.calciumEnabled) {
    return { status: "NOT_APPLICABLE", completedRbcUnitsTotal: state.completedRbcUnitsTotal,
      calciumAdministrations: state.calciumAdministrations.length, explanation: "Kaltsiumiasendus ei olnud kasutusel." };
  }
  if (state.calciumRecommended) return { status: "NOT_MET", completedRbcUnitsTotal: state.completedRbcUnitsTotal,
    calciumAdministrations: state.calciumAdministrations.length, explanation: "Näidustatud kaltsium jäi manustamata." };
  if (state.calciumAdministrations.length === 0) return { status: "NOT_APPLICABLE", completedRbcUnitsTotal: state.completedRbcUnitsTotal,
    calciumAdministrations: 0, explanation: "Kaltsiumi soovitusläve ei ületatud." };
  return { status: "MET", completedRbcUnitsTotal: state.completedRbcUnitsTotal,
    calciumAdministrations: state.calciumAdministrations.length, explanation: "Näidustatud kaltsium manustati." };
}
