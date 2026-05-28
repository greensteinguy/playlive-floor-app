// Typed errors for the data layer. Callers catch these for specific handling
// (e.g., show "not found" UI vs generic error UI).

export class DataLayerError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DataLayerError'
  }
}

export class NotFoundError extends DataLayerError {
  constructor(path) {
    super(`Document not found at ${Array.isArray(path) ? path.join('/') : path}`)
    this.name = 'NotFoundError'
    this.path = path
  }
}

export class ValidationError extends DataLayerError {
  /**
   * @param {string} path  - the doc path that failed validation
   * @param {import('zod').ZodError} zodError  - the underlying Zod error
   * @param {'read' | 'write'} direction  - whether the failure happened on a read or write
   */
  constructor(path, zodError, direction) {
    const pathStr = Array.isArray(path) ? path.join('/') : path
    super(
      `Validation failed on ${direction} of ${pathStr}: ${zodError.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`
    )
    this.name = 'ValidationError'
    this.path = path
    this.zodError = zodError
    this.direction = direction
  }
}

export class MockModeError extends DataLayerError {
  constructor() {
    super(
      'Data layer is not available in mock mode (VITE_USE_MOCK_DATA=true). Set VITE_USE_MOCK_DATA=false in .env.local and configure Firebase to use Firestore.'
    )
    this.name = 'MockModeError'
  }
}
