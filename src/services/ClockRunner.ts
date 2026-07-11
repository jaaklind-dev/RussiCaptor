import { tickExerciseClock } from "@/services/ClockService";

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startClockRunner(): void {
  console.log("CLOCK RUNNER START");

  if (intervalId !== null) {
    console.log("CLEARING OLD CLOCK RUNNER");
    clearInterval(intervalId);
  }

  intervalId = setInterval(() => {
    console.log("CLOCK RUNNER TICK");
    tickExerciseClock();
  }, 1000);
}

export function stopClockRunner(): void {
  console.log("CLOCK RUNNER STOP");

  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}