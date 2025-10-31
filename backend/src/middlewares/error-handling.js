import { AppError } from "@/utils/app-error.js";

function errorHandling(error, req, res, next) {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      message: error.message,
      details: error.details ?? null,
    });
  }

  console.error("Unhandled error", error);
  return res.status(500).json({ message: "Erro interno do servidor" });
}

export { errorHandling };
