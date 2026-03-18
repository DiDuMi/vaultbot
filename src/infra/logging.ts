type LogFields = {
  component: string;
  op: string;
  [key: string]: unknown;
};

const formatError = (error: unknown) => {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: string | number };
    return {
      name: error.name,
      message: error.message,
      code: withCode.code
    };
  }
  return { message: String(error ?? "unknown error") };
};

export const logError = (fields: LogFields, error: unknown) => {
  console.error(
    JSON.stringify({
      level: "error",
      at: new Date().toISOString(),
      ...fields,
      error: formatError(error)
    })
  );
};
