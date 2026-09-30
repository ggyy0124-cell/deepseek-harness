/** Typed test doubles for Task tests: a double supplies only the members its test exercises. */

/**
 * Present a test double as the interface its consumer requires. The double
 * implements only what the test exercises, so it is typed at this one boundary.
 * @param double - the object standing in for the service; its members must be members of `T`.
 * @returns the same object, typed as the interface.
 */
export function stub<T extends object>(double: Partial<Record<keyof T, unknown>>): T {
  const value: unknown = double
  return value as T
}
