/** Erros de domínio. As ações convertem estes erros em mensagens para a interface. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly code: "forbidden" | "not_found" | "validation" | "conflict" | "limit" | "unauthenticated",
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Você não tem permissão para realizar esta ação.") {
    super(message, "forbidden");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Registro não encontrado.") {
    super(message, "not_found");
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fieldErrors?: Record<string, string[]>) {
    super(message, "validation", fieldErrors);
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "conflict");
  }
}

export class LimitError extends AppError {
  constructor(message: string) {
    super(message, "limit");
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = "Sua sessão expirou. Entre novamente.") {
    super(message, "unauthenticated");
  }
}
