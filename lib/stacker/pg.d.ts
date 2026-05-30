declare module "pg" {
  export class Pool {
    constructor(options?: Record<string, unknown>)
    query(text: string, params?: unknown[]): Promise<{ rows: any[] }>
    connect(): Promise<{
      query(text: string, params?: unknown[]): Promise<{ rows: any[] }>
      release(): void
    }>
  }
}
