import { tickExerciseClock } from "@/services/ClockService";

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startClockRunner(): void {

  if (intervalId !== null) {

    clearInterval(intervalId);

  }

  intervalId = setInterval(() => {

    tickExerciseClock();

  }, 10000);

}

export function stopClockRunner(): void {

  if (intervalId !== null) {

    clearInterval(intervalId);

    intervalId = null;

  }

}