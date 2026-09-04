// One owner for asynchronous account work. Starting or invalidating an operation makes every
// older token stale; callers check the token after each await before committing UI/auth state.
export interface AccountOperation {
  isCurrent(): boolean;
}

export class AccountOperations {
  private generation = 0;

  begin(): AccountOperation {
    const generation = ++this.generation;
    return { isCurrent: () => generation === this.generation };
  }

  invalidate(): void {
    this.generation++;
  }
}
