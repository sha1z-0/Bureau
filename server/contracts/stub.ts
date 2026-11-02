/** Thrown by Phase 0 stubs until the owning agent lands its implementation. */
export class NotImplemented extends Error {
  constructor(owner: string, what: string) {
    super(`${what} is not implemented yet (owner: ${owner})`);
    this.name = 'NotImplemented';
  }
}
