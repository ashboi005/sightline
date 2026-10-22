import type { JobRepository, PlatformJob } from "./types";

export class JobRunner {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private stopped = true;
  private readonly running = new Set<Promise<void>>();

  constructor(private readonly jobs: JobRepository, private readonly execute: (job: PlatformJob) => Promise<void>) {}

  start() {
    this.stopped = false;
    this.wake();
  }

  wake() {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.tick().catch((error) => console.error("[jobs] polling failed", error)).finally(() => {
        if (!this.stopped) this.timer = setTimeout(() => { this.timer = undefined; this.wake(); }, 250);
      });
    }, 0);
  }

  private async tick() {
    while (!this.stopped && this.running.size < 2) {
      const job = await this.jobs.claim(Date.now());
      if (!job) break;
      const heartbeat = setInterval(() => void this.jobs.renew(job, Date.now()).catch((error) => console.error("[jobs] lease renewal failed", error)), 15_000);
      const work = this.execute(job).catch((error) => console.error("[jobs] execution failed", error)).finally(() => {
        clearInterval(heartbeat);
        this.running.delete(work);
      });
      this.running.add(work);
    }
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    await Promise.allSettled([...this.running]);
  }
}
