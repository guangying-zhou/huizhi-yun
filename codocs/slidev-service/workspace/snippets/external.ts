// #region snippet
export function emptyArray<T>(length: number): T[] {
  return Array.from({ length }) as T[]
}

export function sayHello() {
  console.log('Hello from external snippet!')
}
// #endregion snippet
