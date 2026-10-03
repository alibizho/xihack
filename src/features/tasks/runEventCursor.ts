export class RunEventCursor {
  private sequence: number;

  constructor(initialSequence = 0) {
    this.sequence = Number.isSafeInteger(initialSequence) && initialSequence >= 0
      ? initialSequence
      : 0;
  }

  get current() {
    return this.sequence;
  }

  accept(lastEventId: string) {
    if (!/^\d+$/.test(lastEventId)) return false;
    const sequence = Number(lastEventId);
    if (!Number.isSafeInteger(sequence) || sequence <= this.sequence) return false;
    this.sequence = sequence;
    return true;
  }

  advanceTo(sequence: number) {
    if (Number.isSafeInteger(sequence) && sequence > this.sequence) {
      this.sequence = sequence;
    }
  }
}
