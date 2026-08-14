export type PipelineYield = () => Promise<void>;

export const yieldToEventLoop: PipelineYield = () =>
  new Promise(resolve => setTimeout(resolve, 0));

/** Drops one obsolete preparation, then forces progress under continuous input. */
export class BoundedObsoleteGenerationGate {
  private droppedSincePublication = false;

  shouldDrop(isCurrent: boolean): boolean {
    if (isCurrent) {
      this.droppedSincePublication = false;
      return false;
    }
    if (!this.droppedSincePublication) {
      this.droppedSincePublication = true;
      return true;
    }
    this.droppedSincePublication = false;
    return false;
  }
}

/** One active preparation plus one integer marker for the newest desired state. */
export class LatestGenerationPipeline {
  private desiredGeneration = 0;
  private completedGeneration = 0;
  private active = false;
  private peakPending = 0;
  private idleListeners: (() => void)[] = [];

  constructor(
    private readonly prepare: (generation: number, yieldControl: PipelineYield) => Promise<void>,
    private readonly yieldControl: PipelineYield = yieldToEventLoop,
  ) {}

  request(): number {
    this.desiredGeneration += 1;
    if (this.active) this.peakPending = 1;
    if (!this.active) void this.run();
    return this.desiredGeneration;
  }

  latest(): number { return this.desiredGeneration; }
  isCurrent(generation: number): boolean { return generation === this.desiredGeneration; }
  activeCount(): number { return this.active ? 1 : 0; }
  peakQueuedGenerations(): number { return this.peakPending; }

  async idle(): Promise<void> {
    if (!this.active && this.completedGeneration === this.desiredGeneration) return;
    await new Promise<void>(resolve => this.idleListeners.push(resolve));
  }

  private async run(): Promise<void> {
    this.active = true;
    try {
      while (this.completedGeneration < this.desiredGeneration) {
        const generation = this.desiredGeneration;
        await this.yieldControl();
        await this.prepare(generation, this.yieldControl);
        this.completedGeneration = generation;
      }
    } finally {
      this.active = false;
      if (this.completedGeneration < this.desiredGeneration) void this.run();
      else this.idleListeners.splice(0).forEach(resolve => resolve());
    }
  }
}
