class LockController {
  private waiting: AbortController[] | Error = [];
  startWaiting(): AbortSignal {
    if (!Array.isArray(this.waiting)) {
      throw new Error("LockController closed", { cause: this.waiting });
    }
    const controller = new AbortController();
    this.waiting.push(controller);
    return controller.signal;
  }
  stopWaiting(signal?: AbortSignal) {
    if (signal === undefined) {
      return;
    }
    if (signal.aborted) {
      throw new Error("LockController closed", { cause: signal.reason });
    }
    if (!Array.isArray(this.waiting)) {
      throw new Error("LockController closed", { cause: this.waiting });
    }
    this.waiting = this.waiting.filter(
      (controller) => controller.signal !== signal,
    );
  }
  close() {
    if (Array.isArray(this.waiting)) {
      this.waiting?.forEach((controller) => controller.abort());
      this.waiting = new Error("Closing LockController");
    }
  }
}

export default LockController;
